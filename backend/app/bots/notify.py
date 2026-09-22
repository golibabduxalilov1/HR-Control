"""Outbound Telegram notifications (feed, late/absent alerts, HR requests, tasks)."""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup
from sqlalchemy import select

from app.bots.manager import bot_manager
from app.bots.templates import BUTTONS, t
from app.core.project_settings import merged_settings
from app.models import AbsenceRequest, AttendanceDay, AttendanceEvent, BotKind, BotSubscriber, Employee, EventDirection, Project, RequestStatus, Task, TaskStatus
from app.services.files import upload_root


def _lang(project: Project, chat_id: str | int | None = None) -> str:
    if chat_id is not None:
        langs = (project.settings or {}).get("telegram_user_langs", {})
        if str(chat_id) in langs:
            return langs[str(chat_id)]
    return merged_settings(project.settings).get("telegram_default_lang", "ru")


def _tpl(project: Project, lang: str) -> dict:
    return (project.settings or {}).get(f"telegram_templates_{lang}", {})


def fmt_money(v) -> str:
    return f"{float(v):,.0f} сум".replace(",", " ")


def fmt_min(m: int) -> str:
    h, mm = divmod(int(m), 60)
    return f"{h} ч {mm} мин" if h else f"{mm} мин"


async def _safe_send(kind: str, project: Project, chat_id, text: str, photo: str | None = None, reply_markup=None) -> bool:
    s = merged_settings(project.settings)
    token = s.get({"registration": "telegram_bot_token", "attendance_feed": "attendance_feed_bot_token", "late_absent": "late_absent_bot_token"}[kind])
    if not token or not chat_id:
        return False
    try:
        await bot_manager.send(kind, chat_id, text, project_id=project.id, photo=photo, reply_markup=reply_markup)
        return True
    except Exception:  # noqa: BLE001
        try:
            await bot_manager.send(token, chat_id, text, photo=photo, reply_markup=reply_markup)
            return True
        except Exception:  # noqa: BLE001
            return False


async def allowed_subscriber(db, project: Project, kind: BotKind, chat_id: str) -> bool:
    s = merged_settings(project.settings)
    key = "attendance_feed_chat_ids" if kind == BotKind.attendance_feed else "late_absent_chat_ids"
    if chat_id in [str(x) for x in s.get(key, [])]:
        return True
    sub = (await db.execute(select(BotSubscriber).where(BotSubscriber.project_id == project.id, BotSubscriber.bot_kind == kind, BotSubscriber.chat_id == chat_id))).scalars().first()
    return bool(sub and sub.status == RequestStatus.approved)


async def _recipients(db, project: Project, kind: BotKind) -> list[str]:
    s = merged_settings(project.settings)
    key = "attendance_feed_chat_ids" if kind == BotKind.attendance_feed else "late_absent_chat_ids"
    ids = {str(x) for x in s.get(key, []) if x}
    subs = (await db.execute(select(BotSubscriber.chat_id).where(BotSubscriber.project_id == project.id, BotSubscriber.bot_kind == kind, BotSubscriber.status == RequestStatus.approved))).scalars()
    ids.update(subs)
    return list(ids)


async def _manager_chat_ids(db, project: Project, key_ids: str, key_emp: str) -> list[str]:
    s = merged_settings(project.settings)
    ids = {str(x) for x in s.get(key_ids, []) if x}
    emp_ids = s.get(key_emp, [])
    if emp_ids:
        rows = (await db.execute(select(Employee.telegram_chat_id).where(Employee.id.in_(emp_ids), Employee.telegram_chat_id.isnot(None)))).scalars()
        ids.update(rows)
    if s.get("telegram_chat_id"):
        ids.add(str(s["telegram_chat_id"]))
    return list(ids)


# ------------------------------------------------------------------ events


async def notify_pass(db, project: Project, emp: Employee, ev: AttendanceEvent, row: AttendanceDay) -> None:
    s = merged_settings(project.settings)
    tz = ZoneInfo(project.timezone)
    lang = _lang(project)
    photo = str(upload_root() / (ev.photo_path or emp.avatar_path)) if (ev.photo_path or emp.avatar_path) else None
    if s.get("attendance_feed_enabled"):
        direction = ("Вход" if lang == "ru" else "Kirish") if ev.direction == EventDirection.check_in else ("Выход" if lang == "ru" else "Chiqish")
        late = f"\n⏰ {'Опоздание' if lang == 'ru' else 'Kechikish'} {fmt_min(row.late_minutes)}" if row.late_minutes and ev.direction == EventDirection.check_in else ""
        text = t(_tpl(project, lang), lang, "feed_pass", icon="🟢" if ev.direction == EventDirection.check_in else "🔴", full_name=emp.full_name,
                 position=f" · {emp.position.name}" if emp.position else "", time=ev.event_time.astimezone(tz).strftime("%H:%M"), direction=direction, late=late)
        for chat_id in await _recipients(db, project, BotKind.attendance_feed):
            await _safe_send("attendance_feed", project, chat_id, text, photo=photo)
    if s.get("late_absent_enabled") and row.late_minutes and ev.direction == EventDirection.check_in:
        start = emp.schedule.start_time.strftime("%H:%M") if emp.schedule and emp.schedule.start_time else "—"
        text = t(_tpl(project, lang), lang, "late_alert", full_name=emp.full_name, department=f" · {emp.department.name}" if emp.department else "",
                 time=ev.event_time.astimezone(tz).strftime("%H:%M"), start=start, late=fmt_min(row.late_minutes))
        for chat_id in await _recipients(db, project, BotKind.late_absent):
            await _safe_send("late_absent", project, chat_id, text, photo=photo)
    # managers via the main bot
    if s.get("notify_telegram") and row.late_minutes and ev.direction == EventDirection.check_in:
        for chat_id in await _manager_chat_ids(db, project, "telegram_manager_chat_ids", "telegram_manager_employee_ids"):
            await _safe_send("registration", project, chat_id, f"⏰ {emp.full_name}: опоздание {fmt_min(row.late_minutes)} ({ev.event_time.astimezone(tz):%H:%M})")


async def notify_absent_list(db, project: Project, absent: list[Employee], day) -> None:
    if not absent or not merged_settings(project.settings).get("late_absent_enabled"):
        return
    lang = _lang(project)
    lines = "\n".join(f"• {e.full_name}" + (f" · {e.department.name}" if e.department else "") for e in absent)
    text = t(_tpl(project, lang), lang, "absent_alert", date=day.strftime("%d.%m.%Y"), count=len(absent), list=lines)
    for chat_id in await _recipients(db, project, BotKind.late_absent):
        await _safe_send("late_absent", project, chat_id, text)


async def today_lists(db, project: Project, button_text: str) -> tuple[str, list[tuple[str, str]]]:
    from app.services.timesheet import TimesheetService

    ts = TimesheetService(db, project)
    today = datetime.now(ts.tz).date()
    emps = (await db.execute(select(Employee).where(Employee.project_id == project.id, Employee.deleted_at.is_(None), Employee.status == "active"))).scalars().unique().all()
    res = await ts.recompute(emps, today, today, persist=False)
    came, late, absent, photos = [], [], [], []
    for e in emps:
        row, _ = res[(e.id, today)]
        if row.check_in:
            line = f"• {e.full_name} — {row.check_in.astimezone(ts.tz):%H:%M}" + (f"–{row.check_out.astimezone(ts.tz):%H:%M}" if row.check_out else "")
            came.append(line)
            if e.avatar_path:
                photos.append((line, str(upload_root() / e.avatar_path)))
            if row.late_minutes:
                late.append(f"{line} (+{fmt_min(row.late_minutes)})")
        elif row.status.value == "absent":
            absent.append(f"• {e.full_name}")
    if any(button_text == BUTTONS[l]["not_came"] for l in BUTTONS):
        return (f"🚫 <b>Не пришли ({today:%d.%m.%Y})</b> — {len(absent)}\n\n" + ("\n".join(absent) or "—")), []
    if any(button_text == BUTTONS[l]["late_list"] for l in BUTTONS):
        return (f"⏰ <b>Опоздали ({today:%d.%m.%Y})</b> — {len(late)}\n\n" + ("\n".join(late) or "—")), []
    return (f"📋 <b>Пришли сегодня ({today:%d.%m.%Y})</b> — {len(came)} из {len(emps)}\n\n" + ("\n".join(came) or "—")), photos


# ------------------------------------------------------------------ requests


async def notify_hr_request(db, project: Project, req: AbsenceRequest, emp: Employee) -> None:
    lang = _lang(project)
    kind = ("Не смогу прийти" if lang == "ru" else "Kela olmayman") if req.kind.value == "absent" else ("Опаздываю" if lang == "ru" else "Kechikyapman")
    text = t(_tpl(project, lang), lang, "hr_request", kind=kind, full_name=emp.full_name, department=f" · {emp.department.name}" if emp.department else "",
             date=req.request_date.strftime("%d.%m.%Y"), late=f" · +{req.late_minutes} мин" if req.late_minutes else "", reason=req.reason or "—")
    kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text=BUTTONS[lang]["accept"], callback_data=f"req:{req.id}:approved"),
                                                InlineKeyboardButton(text=BUTTONS[lang]["reject"], callback_data=f"req:{req.id}:rejected")]])
    photo = str(upload_root() / req.photo_path) if req.photo_path else None
    for chat_id in await _manager_chat_ids(db, project, "telegram_hr_chat_ids", "telegram_hr_employee_ids"):
        await _safe_send("registration", project, chat_id, text, photo=photo, reply_markup=kb)


async def notify_request_decision(db, project: Project, req: AbsenceRequest, emp: Employee) -> None:
    if not emp.telegram_chat_id:
        return
    lang = _lang(project, emp.telegram_chat_id)
    key = "request_approved" if req.status == RequestStatus.approved else "request_rejected"
    await _safe_send("registration", project, emp.telegram_chat_id, t(_tpl(project, lang), lang, key, date=req.request_date.strftime("%d.%m.%Y"), comment=req.decision_comment or ""))


# ------------------------------------------------------------------ tasks


async def notify_new_task(db, project: Project, task: Task, emp: Employee) -> None:
    if not emp.telegram_chat_id:
        return
    lang = _lang(project, emp.telegram_chat_id)
    kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text=BUTTONS[lang]["accept_task"], callback_data=f"task_accept:{task.id}")]])
    text = t(_tpl(project, lang), lang, "new_task", title=task.title, description=task.description or "", bonus=fmt_money(task.bonus_amount) if task.bonus_amount else "—")
    photo = str(upload_root() / task.photo_path) if task.photo_path else None
    await _safe_send("registration", project, emp.telegram_chat_id, text, photo=photo, reply_markup=kb)


async def notify_task_review(db, project: Project, task: Task, emp: Employee) -> None:
    if not emp.telegram_chat_id:
        return
    lang = _lang(project, emp.telegram_chat_id)
    key = "task_approved" if task.status == TaskStatus.approved else "task_rejected"
    await _safe_send("registration", project, emp.telegram_chat_id, t(_tpl(project, lang), lang, key, title=task.title, bonus=fmt_money(task.bonus_amount)))
