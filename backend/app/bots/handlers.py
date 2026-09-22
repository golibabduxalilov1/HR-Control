"""aiogram handlers for the three bot kinds."""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from aiogram import Bot, Dispatcher, F, Router
from aiogram.filters import Command, CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import (
    CallbackQuery,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    KeyboardButton,
    Message,
    ReplyKeyboardMarkup,
    ReplyKeyboardRemove,
)
from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified

from app.bots.templates import BUTTONS, STATUS_LABELS, t
from app.core.project_settings import merged_settings
from app.db.session import SessionLocal
from app.models import (
    AbsenceRequest,
    BotKind,
    BotSubscriber,
    Employee,
    EmployeeStatus,
    Project,
    RateType,
    RequestKind,
    RequestStatus,
    SalaryRate,
    ScheduleMode,
    Task,
    TaskStatus,
    WorkMode,
)
from app.services.files import save_bytes
from app.services.payroll import PayrollService, month_bounds
from app.services.timesheet import TimesheetService

MONTHS_RU = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"]


class Reg(StatesGroup):
    name = State()
    phone = State()
    photo = State()


class Absence(StatesGroup):
    date = State()
    reason = State()
    photo = State()


class Late(StatesGroup):
    minutes = State()
    reason = State()


class TaskResult(StatesGroup):
    result = State()


# ------------------------------------------------------------------ helpers


async def load_project(project_id: int, db) -> Project:
    return await db.get(Project, project_id)


def user_lang(project: Project, chat_id: int) -> str:
    langs = (project.settings or {}).get("telegram_user_langs", {})
    return langs.get(str(chat_id)) or merged_settings(project.settings).get("telegram_default_lang", "ru")


def templates(project: Project, lang: str) -> dict:
    return (project.settings or {}).get(f"telegram_templates_{lang}", {})


def main_kb(lang: str, registered: bool, work_mode: str | None = None) -> ReplyKeyboardMarkup:
    b = BUTTONS[lang]
    if not registered:
        rows = [[KeyboardButton(text=b["register"])], [KeyboardButton(text=b["lang"]), KeyboardButton(text=b["help"])]]
    else:
        rows = [[KeyboardButton(text=b["status"]), KeyboardButton(text=b["hours"])],
                [KeyboardButton(text=b["salary"]), KeyboardButton(text=b["timesheet"])],
                [KeyboardButton(text=b["absence"]), KeyboardButton(text=b["late"])]]
        if work_mode in ("remote", "hybrid"):
            rows.append([KeyboardButton(text=b["checkin"]), KeyboardButton(text=b["checkout"])])
        rows.append([KeyboardButton(text=b["lang"]), KeyboardButton(text=b["help"])])
    return ReplyKeyboardMarkup(keyboard=rows, resize_keyboard=True)


def cancel_kb(lang: str, extra: list[str] | None = None) -> ReplyKeyboardMarkup:
    rows = [[KeyboardButton(text=x) for x in extra]] if extra else []
    rows.append([KeyboardButton(text=BUTTONS[lang]["cancel"])])
    return ReplyKeyboardMarkup(keyboard=rows, resize_keyboard=True)


def lang_kb() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="🇷🇺 Русский", callback_data="lang:ru"),
                                                  InlineKeyboardButton(text="🇺🇿 O'zbek", callback_data="lang:uz")]])


async def find_employee(db, project_id: int, chat_id: int) -> Employee | None:
    return (await db.execute(select(Employee).where(Employee.project_id == project_id, Employee.telegram_chat_id == str(chat_id), Employee.deleted_at.is_(None)))).scalars().first()


def is_button(text: str | None, key: str) -> bool:
    return bool(text) and any(text == BUTTONS[l][key] for l in BUTTONS)


def fmt_money(v) -> str:
    return f"{float(v):,.0f} сум".replace(",", " ")


def fmt_min(m: int) -> str:
    h, mm = divmod(int(m), 60)
    return f"{h} ч {mm} мин"


async def download_photo(bot: Bot, message: Message, project_slug: str, folder: str, name: str) -> str | None:
    if not message.photo:
        return None
    file = await bot.get_file(message.photo[-1].file_id)
    buf = await bot.download_file(file.file_path)
    return save_bytes(buf.read(), project_slug, folder, f"{name}.jpg")


# ------------------------------------------------------------------ registration bot


def registration_router() -> Router:
    r = Router()

    @r.message(CommandStart())
    async def start(message: Message, state: FSMContext, project_id: int):
        await state.clear()
        async with SessionLocal() as db:
            project = await load_project(project_id, db)
            emp = await find_employee(db, project_id, message.chat.id)
            lang = user_lang(project, message.chat.id)
            if str(message.chat.id) not in (project.settings or {}).get("telegram_user_langs", {}):
                await message.answer(t(templates(project, lang), lang, "choose_language"), reply_markup=lang_kb())
            await message.answer(t(templates(project, lang), lang, "welcome", company=project.name),
                                 reply_markup=main_kb(lang, emp is not None, emp.work_mode.value if emp else None))

    @r.callback_query(F.data.startswith("lang:"))
    async def set_lang(cb: CallbackQuery, project_id: int):
        lang = cb.data.split(":")[1]
        async with SessionLocal() as db:
            project = await load_project(project_id, db)
            s = dict(project.settings or {})
            s.setdefault("telegram_user_langs", {})[str(cb.message.chat.id)] = lang
            project.settings = s
            flag_modified(project, "settings")
            await db.commit()
            emp = await find_employee(db, project_id, cb.message.chat.id)
            await cb.message.answer(t(templates(project, lang), lang, "language_changed", lang_name="Русский" if lang == "ru" else "O'zbek"),
                                    reply_markup=main_kb(lang, emp is not None, emp.work_mode.value if emp else None))
        await cb.answer()

    @r.message(F.text.func(lambda x: is_button(x, "lang")))
    async def ask_lang(message: Message):
        await message.answer("🌐", reply_markup=lang_kb())

    @r.message(F.text.func(lambda x: is_button(x, "help")))
    @r.message(Command("help"))
    async def help_(message: Message, project_id: int):
        async with SessionLocal() as db:
            project = await load_project(project_id, db)
            lang = user_lang(project, message.chat.id)
            await message.answer(t(templates(project, lang), lang, "help"))

    @r.message(F.text.func(lambda x: is_button(x, "cancel")))
    async def cancel(message: Message, state: FSMContext, project_id: int):
        await state.clear()
        async with SessionLocal() as db:
            project = await load_project(project_id, db)
            lang = user_lang(project, message.chat.id)
            emp = await find_employee(db, project_id, message.chat.id)
            await message.answer(t(templates(project, lang), lang, "cancelled"), reply_markup=main_kb(lang, emp is not None, emp.work_mode.value if emp else None))

    @r.message(Command("chatid"))
    async def chatid(message: Message):
        await message.answer(f"🆔 Chat ID: <code>{message.chat.id}</code>")

    # -- registration flow

    @r.message(F.text.func(lambda x: is_button(x, "register")))
    @r.message(Command("register"))
    async def reg_start(message: Message, state: FSMContext, project_id: int):
        async with SessionLocal() as db:
            project = await load_project(project_id, db)
            lang = user_lang(project, message.chat.id)
            emp = await find_employee(db, project_id, message.chat.id)
            if emp:
                await message.answer(t(templates(project, lang), lang, "already_registered", full_name=emp.full_name), reply_markup=main_kb(lang, True, emp.work_mode.value))
                return
            await state.set_state(Reg.name)
            await message.answer(t(templates(project, lang), lang, "ask_full_name"), reply_markup=cancel_kb(lang))

    @r.message(Reg.name)
    async def reg_name(message: Message, state: FSMContext, project_id: int):
        async with SessionLocal() as db:
            project = await load_project(project_id, db)
            lang = user_lang(project, message.chat.id)
            name = (message.text or "").strip()
            if len(name) < 2:
                await message.answer(t(templates(project, lang), lang, "empty_name"))
                return
            await state.update_data(name=name)
            await state.set_state(Reg.phone)
            kb = ReplyKeyboardMarkup(keyboard=[[KeyboardButton(text=BUTTONS[lang]["share_phone"], request_contact=True)], [KeyboardButton(text=BUTTONS[lang]["cancel"])]], resize_keyboard=True)
            await message.answer(t(templates(project, lang), lang, "ask_phone"), reply_markup=kb)

    @r.message(Reg.phone)
    async def reg_phone(message: Message, state: FSMContext, project_id: int):
        async with SessionLocal() as db:
            project = await load_project(project_id, db)
            lang = user_lang(project, message.chat.id)
            phone = message.contact.phone_number if message.contact else None
            if not phone:
                await message.answer(t(templates(project, lang), lang, "invalid_phone"))
                return
            phone = "+" + re.sub(r"\D", "", phone)
            await state.update_data(phone=phone)
            await state.set_state(Reg.photo)
            await message.answer(t(templates(project, lang), lang, "ask_photo"), reply_markup=cancel_kb(lang))

    @r.message(Reg.photo)
    async def reg_photo(message: Message, state: FSMContext, bot: Bot, project_id: int):
        async with SessionLocal() as db:
            project = await load_project(project_id, db)
            lang = user_lang(project, message.chat.id)
            if not message.photo:
                await message.answer(t(templates(project, lang), lang, "invalid_photo"))
                return
            data = await state.get_data()
            phone_digits = re.sub(r"\D", "", data["phone"])[-9:]
            # link to an existing employee with the same phone, else create a new one
            existing = (await db.execute(select(Employee).where(Employee.project_id == project_id, Employee.deleted_at.is_(None), Employee.phone.like(f"%{phone_digits}")))).scalars().first()
            if existing:
                emp, key = existing, "success_linked"
            else:
                from app.api.routers.employees import _next_number
                emp = Employee(project_id=project_id, full_name=data["name"], phone=data["phone"], employee_number=await _next_number(db, project_id),
                               schedule_mode=ScheduleMode.flexible, hire_date=date.today(), status=EmployeeStatus.active)
                db.add(emp)
                await db.flush()
                key = "success"
            emp.telegram_chat_id = str(message.chat.id)
            emp.telegram_username = message.from_user.username if message.from_user else None
            emp.avatar_path = await download_photo(bot, message, project.slug, "avatars", str(emp.id))
            await db.commit()
            await state.clear()
            await message.answer(t(templates(project, lang), lang, key, full_name=emp.full_name, phone=emp.phone, employee_number=emp.employee_number),
                                 reply_markup=main_kb(lang, True, emp.work_mode.value))

    # -- info commands

    async def _need_emp(message: Message, db, project: Project, lang: str) -> Employee | None:
        emp = await find_employee(db, project.id, message.chat.id)
        if not emp:
            await message.answer(t(templates(project, lang), lang, "not_registered"), reply_markup=main_kb(lang, False))
        return emp

    @r.message(F.text.func(lambda x: is_button(x, "status")))
    @r.message(Command("status"))
    async def status(message: Message, project_id: int):
        async with SessionLocal() as db:
            project = await load_project(project_id, db)
            lang = user_lang(project, message.chat.id)
            emp = await _need_emp(message, db, project, lang)
            if not emp:
                return
            ts = TimesheetService(db, project)
            today = datetime.now(ts.tz).date()
            start, _ = month_bounds(today.year, today.month)
            res = await ts.recompute_employee(emp, start, today)
            await db.commit()
            row = res[today][0]
            label = STATUS_LABELS[lang].get(row.status.value, row.status.value)
            if row.check_in:
                label += f" · {row.check_in.astimezone(ts.tz):%H:%M}" + (f"–{row.check_out.astimezone(ts.tz):%H:%M}" if row.check_out else "")
            rows = [v[0] for v in res.values()]
            await message.answer(t(templates(project, lang), lang, "status_registered", full_name=emp.full_name, today_status=label,
                                   worked_days=sum(1 for x in rows if x.worked_minutes), scheduled_days=sum(1 for x in rows if x.scheduled_minutes),
                                   late=sum(1 for x in rows if x.late_minutes), absent=sum(1 for x in rows if x.status.value == "absent")))

    @r.message(F.text.func(lambda x: is_button(x, "hours")))
    async def hours(message: Message, project_id: int):
        async with SessionLocal() as db:
            project = await load_project(project_id, db)
            lang = user_lang(project, message.chat.id)
            emp = await _need_emp(message, db, project, lang)
            if not emp:
                return
            today = date.today()
            s = await PayrollService(db, project).earned(emp, *month_bounds(today.year, today.month))
            await db.commit()
            pct = round(s.worked_minutes / s.scheduled_minutes * 100) if s.scheduled_minutes else 0
            await message.answer(t(templates(project, lang), lang, "hours", month=MONTHS_RU[today.month - 1], worked=fmt_min(s.worked_minutes), scheduled=fmt_min(s.scheduled_minutes), pct=pct))

    @r.message(F.text.func(lambda x: is_button(x, "salary")))
    async def salary(message: Message, project_id: int):
        async with SessionLocal() as db:
            project = await load_project(project_id, db)
            lang = user_lang(project, message.chat.id)
            if not merged_settings(project.settings).get("finance_enabled", True):
                return
            emp = await _need_emp(message, db, project, lang)
            if not emp:
                return
            today = date.today()
            s = await PayrollService(db, project).earned(emp, *month_bounds(today.year, today.month))
            await db.commit()
            await message.answer(t(templates(project, lang), lang, "salary", month=MONTHS_RU[today.month - 1], earned=fmt_money(s.earned + s.overtime_pay),
                                   bonuses=fmt_money(s.bonuses), fines=fmt_money(s.fines), paid=fmt_money(s.paid), to_pay=fmt_money(s.to_pay)))

    @r.message(F.text.func(lambda x: is_button(x, "timesheet")))
    async def timesheet(message: Message, project_id: int):
        async with SessionLocal() as db:
            project = await load_project(project_id, db)
            lang = user_lang(project, message.chat.id)
            emp = await _need_emp(message, db, project, lang)
            if not emp:
                return
            ts = TimesheetService(db, project)
            today = datetime.now(ts.tz).date()
            start, end = month_bounds(today.year, today.month)
            res = await ts.recompute_employee(emp, start, min(end, today))
            await db.commit()
            icons = {"on_time": "🟢", "late": "🟡", "early_leave": "🟠", "late_early": "🟠", "absent": "🔴", "excused": "🔵", "remote": "💻", "worked_off": "🟢", "day_off": "⚪", "holiday": "🎉", "planned": "▫️"}
            lines = [f"📄 <b>{MONTHS_RU[today.month - 1].capitalize()} {today.year}</b>"]
            for d, (row, _) in sorted(res.items()):
                extra = f" {row.check_in.astimezone(ts.tz):%H:%M}" if row.check_in else ""
                extra += f"–{row.check_out.astimezone(ts.tz):%H:%M}" if row.check_out else ""
                lines.append(f"{icons.get(row.status.value, '▫️')} {d:%d.%m} {STATUS_LABELS[lang].get(row.status.value, '')}{extra}")
            await message.answer("\n".join(lines))

    # -- remote check-in / check-out

    async def _checkin(message: Message, project_id: int, direction: str):
        from app.integrations.ingest import ingest_event

        async with SessionLocal() as db:
            project = await load_project(project_id, db)
            lang = user_lang(project, message.chat.id)
            emp = await _need_emp(message, db, project, lang)
            if not emp:
                return
            if emp.work_mode == WorkMode.office and not merged_settings(project.settings).get("allow_telegram_checkin"):
                await message.answer(t(templates(project, lang), lang, "checkin_not_allowed"))
                return
            now = datetime.now(ZoneInfo(project.timezone))
            await ingest_event(db, project, employee=emp, event_time=now, direction=direction, device_label="Telegram", source="telegram")
            await db.commit()
            kind = BUTTONS[lang]["checkin"] if direction == "in" else BUTTONS[lang]["checkout"]
            await message.answer(t(templates(project, lang), lang, "checkin_done", kind=kind, time=now.strftime("%H:%M")))

    @r.message(F.text.func(lambda x: is_button(x, "checkin")))
    async def checkin(message: Message, project_id: int):
        await _checkin(message, project_id, "in")

    @r.message(F.text.func(lambda x: is_button(x, "checkout")))
    async def checkout(message: Message, project_id: int):
        await _checkin(message, project_id, "out")

    # -- absence request

    @r.message(F.text.func(lambda x: is_button(x, "absence")))
    async def absence_start(message: Message, state: FSMContext, project_id: int):
        async with SessionLocal() as db:
            project = await load_project(project_id, db)
            lang = user_lang(project, message.chat.id)
            if not await _need_emp(message, db, project, lang):
                return
            await state.set_state(Absence.date)
            await message.answer(t(templates(project, lang), lang, "ask_absence_date"), reply_markup=cancel_kb(lang, [BUTTONS[lang]["today"], BUTTONS[lang]["tomorrow"]]))

    @r.message(Absence.date)
    async def absence_date(message: Message, state: FSMContext, project_id: int):
        async with SessionLocal() as db:
            project = await load_project(project_id, db)
            lang = user_lang(project, message.chat.id)
            txt = (message.text or "").strip()
            today = datetime.now(ZoneInfo(project.timezone)).date()
            if is_button(txt, "today"):
                d = today
            elif is_button(txt, "tomorrow"):
                d = today + timedelta(days=1)
            else:
                m = re.match(r"^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})$", txt)
                if not m:
                    await message.answer(t(templates(project, lang), lang, "ask_absence_date"))
                    return
                y = int(m.group(3))
                d = date(y if y > 100 else 2000 + y, int(m.group(2)), int(m.group(1)))
            await state.update_data(date=d.isoformat())
            await state.set_state(Absence.reason)
            await message.answer(t(templates(project, lang), lang, "ask_absence_reason"), reply_markup=cancel_kb(lang))

    @r.message(Absence.reason)
    async def absence_reason(message: Message, state: FSMContext, project_id: int):
        async with SessionLocal() as db:
            project = await load_project(project_id, db)
            lang = user_lang(project, message.chat.id)
            await state.update_data(reason=(message.text or "").strip())
            await state.set_state(Absence.photo)
            await message.answer(t(templates(project, lang), lang, "ask_absence_photo"), reply_markup=cancel_kb(lang, [BUTTONS[lang]["no_photo"]]))

    @r.message(Absence.photo)
    async def absence_photo(message: Message, state: FSMContext, bot: Bot, project_id: int):
        from app.bots.notify import notify_hr_request

        async with SessionLocal() as db:
            project = await load_project(project_id, db)
            lang = user_lang(project, message.chat.id)
            emp = await find_employee(db, project_id, message.chat.id)
            data = await state.get_data()
            req = AbsenceRequest(project_id=project_id, employee_id=emp.id, kind=RequestKind.absent, request_date=date.fromisoformat(data["date"]),
                                 reason=data.get("reason", ""), submitted_via="telegram")
            if message.photo:
                req.photo_path = await download_photo(bot, message, project.slug, "requests", f"req-{emp.id}-{int(datetime.now().timestamp())}")
            db.add(req)
            await db.commit()
            await state.clear()
            await message.answer(t(templates(project, lang), lang, "absence_sent"), reply_markup=main_kb(lang, True, emp.work_mode.value))
            await notify_hr_request(db, project, req, emp)

    # -- late notice

    @r.message(F.text.func(lambda x: is_button(x, "late")))
    async def late_start(message: Message, state: FSMContext, project_id: int):
        async with SessionLocal() as db:
            project = await load_project(project_id, db)
            lang = user_lang(project, message.chat.id)
            if not await _need_emp(message, db, project, lang):
                return
            await state.set_state(Late.minutes)
            await message.answer(t(templates(project, lang), lang, "ask_late_minutes"), reply_markup=cancel_kb(lang, ["15", "30", "60"]))

    @r.message(Late.minutes)
    async def late_minutes(message: Message, state: FSMContext, project_id: int):
        async with SessionLocal() as db:
            project = await load_project(project_id, db)
            lang = user_lang(project, message.chat.id)
            digits = re.sub(r"\D", "", message.text or "")
            if not digits:
                await message.answer(t(templates(project, lang), lang, "ask_late_minutes"))
                return
            await state.update_data(minutes=int(digits))
            await state.set_state(Late.reason)
            await message.answer(t(templates(project, lang), lang, "ask_late_reason"), reply_markup=cancel_kb(lang))

    @r.message(Late.reason)
    async def late_reason(message: Message, state: FSMContext, bot: Bot, project_id: int):
        from app.bots.notify import notify_hr_request

        async with SessionLocal() as db:
            project = await load_project(project_id, db)
            lang = user_lang(project, message.chat.id)
            emp = await find_employee(db, project_id, message.chat.id)
            data = await state.get_data()
            today = datetime.now(ZoneInfo(project.timezone)).date()
            req = AbsenceRequest(project_id=project_id, employee_id=emp.id, kind=RequestKind.late, request_date=today, late_minutes=data["minutes"],
                                 reason=(message.text or "").strip() if not message.photo else (message.caption or ""), submitted_via="telegram")
            if message.photo:
                req.photo_path = await download_photo(bot, message, project.slug, "requests", f"late-{emp.id}-{int(datetime.now().timestamp())}")
            db.add(req)
            await db.commit()
            await state.clear()
            await message.answer(t(templates(project, lang), lang, "late_sent"), reply_markup=main_kb(lang, True, emp.work_mode.value))
            await notify_hr_request(db, project, req, emp)

    # -- tasks

    @r.callback_query(F.data.startswith("task_accept:"))
    async def task_accept(cb: CallbackQuery, state: FSMContext, project_id: int):
        task_id = int(cb.data.split(":")[1])
        async with SessionLocal() as db:
            project = await load_project(project_id, db)
            lang = user_lang(project, cb.message.chat.id)
            task = await db.get(Task, task_id)
            if not task or task.project_id != project_id:
                await cb.answer("—")
                return
            if task.status == TaskStatus.pending:
                task.status, task.accepted_at = TaskStatus.accepted, datetime.now()
                await db.commit()
            await state.set_state(TaskResult.result)
            await state.update_data(task_id=task_id)
            await cb.message.answer(t(templates(project, lang), lang, "task_result_ask", title=task.title), reply_markup=cancel_kb(lang))
        await cb.answer()

    @r.message(TaskResult.result)
    async def task_result(message: Message, state: FSMContext, bot: Bot, project_id: int):
        async with SessionLocal() as db:
            project = await load_project(project_id, db)
            lang = user_lang(project, message.chat.id)
            data = await state.get_data()
            task = await db.get(Task, data["task_id"])
            emp = await find_employee(db, project_id, message.chat.id)
            task.result_text = (message.caption or message.text or "").strip()
            if message.photo:
                task.result_photo_path = await download_photo(bot, message, project.slug, "tasks", f"result-{task.id}")
            task.status, task.completed_at = TaskStatus.review, datetime.now()
            await db.commit()
            await state.clear()
            await message.answer(t(templates(project, lang), lang, "task_result_sent"), reply_markup=main_kb(lang, True, emp.work_mode.value if emp else None))

    # -- HR inline decisions on requests (buttons sent to HR chats)

    @r.callback_query(F.data.startswith("req:"))
    async def hr_decide(cb: CallbackQuery, project_id: int):
        from app.api.routers.requests_tasks import apply_decision
        from app.bots.notify import notify_request_decision

        _, rid, decision = cb.data.split(":")
        async with SessionLocal() as db:
            project = await load_project(project_id, db)
            req = await db.get(AbsenceRequest, int(rid))
            if not req or req.project_id != project_id:
                await cb.answer("—")
                return
            emp = await db.get(Employee, req.employee_id)
            actor = f"@{cb.from_user.username}" if cb.from_user and cb.from_user.username else str(cb.from_user.id)
            await apply_decision(db, project, req, emp, decision, actor)
            await db.commit()
            await notify_request_decision(db, project, req, emp)
            await cb.message.edit_reply_markup(reply_markup=None)
            await cb.message.answer(("✅ Принято" if decision == "approved" else "❌ Отклонено") + f" · {emp.full_name} · {actor}")
        await cb.answer()

    return r


# ------------------------------------------------------------------ attendance feed / late-absent bots (subscriber bots)


def subscriber_router(kind: str) -> Router:
    r = Router()
    bot_kind = BotKind(kind)

    @r.message(CommandStart())
    async def start(message: Message, project_id: int):
        async with SessionLocal() as db:
            project = await load_project(project_id, db)
            lang = user_lang(project, message.chat.id)
            b = BUTTONS[lang]
            sub = (await db.execute(select(BotSubscriber).where(BotSubscriber.project_id == project_id, BotSubscriber.bot_kind == bot_kind, BotSubscriber.chat_id == str(message.chat.id)))).scalars().first()
            if not sub:
                sub = BotSubscriber(project_id=project_id, bot_kind=bot_kind, chat_id=str(message.chat.id), username=message.from_user.username or "" if message.from_user else "",
                                    full_name=message.from_user.full_name if message.from_user else "")
                db.add(sub)
                await db.commit()
            rows = [[KeyboardButton(text=b["list"]), KeyboardButton(text=b["with_photo"])]] if kind == "attendance_feed" else [[KeyboardButton(text=b["not_came"]), KeyboardButton(text=b["late_list"])]]
            status_txt = {"pending": "⏳ Заявка на подписку отправлена администратору.", "approved": "✅ Подписка активна.", "rejected": "❌ Подписка отклонена."}[sub.status.value]
            await message.answer(f"🤖 <b>{project.name}</b>\n{status_txt}\n🆔 Chat ID: <code>{message.chat.id}</code>", reply_markup=ReplyKeyboardMarkup(keyboard=rows, resize_keyboard=True))

    @r.message(Command("chatid"))
    async def chatid(message: Message):
        await message.answer(f"🆔 Chat ID: <code>{message.chat.id}</code>")

    @r.message(F.text.func(lambda x: is_button(x, "list") or is_button(x, "with_photo") or is_button(x, "not_came") or is_button(x, "late_list")))
    async def lists(message: Message, bot: Bot, project_id: int):
        from app.bots.notify import allowed_subscriber, today_lists

        async with SessionLocal() as db:
            project = await load_project(project_id, db)
            if not await allowed_subscriber(db, project, bot_kind, str(message.chat.id)):
                await message.answer("⏳ Подписка ещё не подтверждена администратором.")
                return
            text, photos = await today_lists(db, project, message.text)
            await message.answer(text)
            if is_button(message.text, "with_photo"):
                from aiogram.types import FSInputFile
                for caption, path in photos[:20]:
                    try:
                        await bot.send_photo(message.chat.id, FSInputFile(path), caption=caption)
                    except Exception:  # noqa: BLE001
                        pass

    return r


def build_dispatcher(kind: str, project_id: int, storage) -> Dispatcher:
    dp = Dispatcher(storage=storage)
    dp.include_router(registration_router() if kind == "registration" else subscriber_router(kind))
    return dp
