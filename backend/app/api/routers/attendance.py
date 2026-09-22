"""Today view, timesheet, day editing, raw pass events."""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.params import Param
from sqlalchemy import func, select

from app.api.routers.employees import base_query, get_employee_or_404, schedule_label, to_out as emp_out
from app.core.deps import DB, AdminOrHr, Auth
from app.core.project_settings import merged_settings
from app.models import (
    AttendanceDay,
    AttendanceEvent,
    DayStatus,
    Employee,
    EmployeeStatus,
    EventDirection,
    EventSource,
    Holiday,
    Schedule,
)
from app.schemas import BulkDayEditIn, DayEditIn, DayOut, EmployeeTimesheetOut, EventOut, ManualEventIn
from app.services.audit import log_action
from app.services.files import public_url
from app.services.payroll import PayrollService, month_bounds
from app.services.timesheet import TimesheetService, business_date_for

router = APIRouter(tags=["attendance"])


def _opt(value):
    """Endpoints call each other internally; unwrap FastAPI Query defaults into None."""
    return None if isinstance(value, Param) else value

STATUS_LABELS = {
    "on_time": "Вовремя", "late": "Опоздание", "early_leave": "Ран. уход", "late_early": "Опозд. + ран. уход",
    "absent": "Отсутствует", "excused": "Уваж. причина", "remote": "Удалённо", "worked_off": "Отработано",
    "leave": "Отпуск", "dismissed": "Уволен", "day_off": "Выходной", "holiday": "Праздник", "planned": "Запланировано",
    "not_hired": "Не принят",
}

PROBLEM_STATUSES = {DayStatus.late, DayStatus.early_leave, DayStatus.late_early, DayStatus.absent}


def fmt_minutes(m: int) -> str:
    h, mm = divmod(max(m, 0), 60)
    return f"{h} ч {mm} мин" if h else f"{mm} мин"


async def active_employees(db, p, branch_id: int | None = None, department_id: int | None = None) -> list[Employee]:
    q = base_query(p.project.id).where(Employee.status != EmployeeStatus.dismissed)
    if p.branch_id:
        q = q.where(Employee.branch_id == p.branch_id)
    elif branch_id:
        q = q.where(Employee.branch_id == branch_id)
    if department_id:
        q = q.where(Employee.department_id == department_id)
    return (await db.execute(q.order_by(Employee.full_name))).scalars().unique().all()


def _ev_out(e: AttendanceEvent, name: str | None = None) -> EventOut:
    return EventOut(id=e.id, employee_id=e.employee_id, employee_name=name, event_time=e.event_time, direction=e.direction.value,
                    source=e.source.value, device_label=e.device_label, hidden=e.hidden, photo_url=public_url(e.photo_path))


# ------------------------------------------------------------------ today


@router.get("/attendance/today")
async def today_view(p: Auth, db: DB, day: date | None = Query(default=None, alias="date"), department_id: int | None = None):
    ts = TimesheetService(db, p.project)
    tz = ts.tz
    day = _opt(day) or datetime.now(tz).date()
    employees = await active_employees(db, p, department_id=_opt(department_id))
    result = await ts.recompute(employees, day, day)
    pay = PayrollService(db, p.project)
    for emp in employees:
        row, _ = result[(emp.id, day)]
        await pay.sync_auto_fines(emp, {day: row}, datetime.now(tz).date())
    await db.commit()

    present, late, absent, on_site, left, remote_list = [], [], [], [], [], []
    for emp in employees:
        row, _ = result[(emp.id, day)]
        item = {
            "employee_id": emp.id, "employee_number": emp.employee_number, "full_name": emp.full_name,
            "position": emp.position.name if emp.position else "", "department_name": emp.department.name if emp.department else None,
            "avatar_url": public_url(emp.avatar_path), "schedule_mode": emp.schedule_mode.value, "status": row.status.value,
            "check_in_time": row.check_in.astimezone(tz).strftime("%H:%M") if row.check_in else None,
            "check_out_time": row.check_out.astimezone(tz).strftime("%H:%M") if row.check_out else None,
            "worked_minutes": row.worked_minutes, "late_minutes": row.late_minutes, "early_leave_minutes": row.early_leave_minutes,
            "problem_reason": None,
        }
        if row.status in (DayStatus.late, DayStatus.late_early):
            item["problem_reason"] = f"Опоздание +{fmt_minutes(row.late_minutes)}"
            late.append(item)
        elif row.status == DayStatus.early_leave:
            item["problem_reason"] = f"Ранний уход −{fmt_minutes(row.early_leave_minutes)}"
            late.append(item)
        elif row.status in (DayStatus.on_time, DayStatus.worked_off):
            present.append(item)
        elif row.status == DayStatus.remote:
            remote_list.append(item)
        elif row.status == DayStatus.absent:
            item["problem_reason"] = "Не отметился сегодня"
            absent.append(item)
        if row.check_in and not row.check_out:
            on_site.append(item)
        elif row.check_in and row.check_out:
            left.append(item)

    total = len(employees)
    working = [e for e in employees if result[(e.id, day)][0].status not in (DayStatus.day_off, DayStatus.holiday, DayStatus.not_hired, DayStatus.leave)]
    att_total = len(working) or total
    came = len(present) + len(late) + len(remote_list)
    return {
        "date": day.isoformat(), "total": total, "attendance_total": att_total, "present": len(present), "late": len(late),
        "absent": len(absent), "remote": len(remote_list), "on_site_now": len(on_site), "left_today": len(left),
        "attendance_rate": round(came / att_total * 100, 1) if att_total else 0,
        "punctuality_rate": round(len(present) / att_total * 100, 1) if att_total else 0,
        "present_list": present, "late_list": late, "absent_list": absent, "remote_list": remote_list,
        "on_site_list": on_site, "left_list": left,
    }


@router.get("/attendance/day-logs")
async def day_logs(p: Auth, db: DB, day: date | None = Query(default=None, alias="date")):
    ts = TimesheetService(db, p.project)
    day = _opt(day) or datetime.now(ts.tz).date()
    employees = await active_employees(db, p)
    events = await ts.events_by_day([e.id for e in employees], day, day)
    names = {e.id: e for e in employees}
    out = []
    for (emp_id, _), evs in events.items():
        for ev in evs:
            emp = names[emp_id]
            out.append({**_ev_out(ev, emp.full_name).model_dump(), "position": emp.position.name if emp.position else "",
                        "department_name": emp.department.name if emp.department else None, "avatar_url": public_url(emp.avatar_path)})
    out.sort(key=lambda x: x["event_time"], reverse=True)
    return {"date": day.isoformat(), "count": len(out), "items": out}


@router.get("/attendance/problematic-month")
async def problematic_month(p: Auth, db: DB, day: date | None = Query(default=None, alias="date")):
    ts = TimesheetService(db, p.project)
    day = _opt(day) or datetime.now(ts.tz).date()
    start, _ = month_bounds(day.year, day.month)
    employees = await active_employees(db, p)
    rows = await ts.existing_days([e.id for e in employees], start, day)
    agg: dict[int, dict] = defaultdict(lambda: {"absent": 0, "late": 0, "early": 0})
    for (emp_id, _), r in rows.items():
        if r.status == DayStatus.absent:
            agg[emp_id]["absent"] += 1
        if r.late_minutes:
            agg[emp_id]["late"] += 1
        if r.early_leave_minutes:
            agg[emp_id]["early"] += 1
    out = []
    for e in employees:
        a = agg.get(e.id)
        if not a or not (a["absent"] or a["late"] or a["early"]):
            continue
        out.append({"employee_id": e.id, "full_name": e.full_name, "position": e.position.name if e.position else "",
                    "department_name": e.department.name if e.department else None, "avatar_url": public_url(e.avatar_path),
                    "absent_days": a["absent"], "late_count": a["late"], "early_count": a["early"],
                    "score": a["absent"] * 3 + a["late"] + a["early"]})
    out.sort(key=lambda x: -x["score"])
    return out


# ------------------------------------------------------------------ employee timesheet


async def _day_out(row: AttendanceDay, evs: list[AttendanceEvent], holidays: dict[date, str], schedules: dict[int, Schedule]) -> DayOut:
    sched = schedules.get(row.schedule_id) if row.schedule_id else None
    return DayOut(
        date=row.date, status=row.status.value, check_in=row.check_in, check_out=row.check_out, worked_minutes=row.worked_minutes,
        scheduled_minutes=row.scheduled_minutes, overtime_minutes=row.overtime_minutes, late_minutes=row.late_minutes,
        early_leave_minutes=row.early_leave_minutes, is_manual=row.is_manual, schedule_id=row.schedule_id,
        schedule_label=(f"{sched.name} · {sched.start_time:%H:%M}–{sched.end_time:%H:%M}" if sched and sched.start_time else (sched.name if sched else None)),
        day_off_override=row.day_off_override, comment=row.comment, is_holiday=row.date in holidays, holiday_name=holidays.get(row.date),
        events=[_ev_out(e) for e in evs],
    )


def summarize(rows: list[AttendanceDay]) -> dict:
    s = {"scheduled_days": 0, "scheduled_minutes": 0, "worked_days": 0, "worked_minutes": 0, "overtime_minutes": 0,
         "on_time": 0, "late": 0, "early_leave": 0, "absent": 0, "excused": 0, "remote": 0, "worked_off": 0, "late_minutes": 0}
    for r in rows:
        if r.scheduled_minutes:
            s["scheduled_days"] += 1
            s["scheduled_minutes"] += r.scheduled_minutes
        if r.worked_minutes:
            s["worked_days"] += 1
            s["worked_minutes"] += r.worked_minutes
        s["overtime_minutes"] += r.overtime_minutes
        s["late_minutes"] += r.late_minutes
        if r.late_minutes:
            s["late"] += 1
        if r.early_leave_minutes:
            s["early_leave"] += 1
        key = {DayStatus.on_time: "on_time", DayStatus.absent: "absent", DayStatus.excused: "excused",
               DayStatus.remote: "remote", DayStatus.worked_off: "worked_off"}.get(r.status)
        if key:
            s[key] += 1
    s["completion_pct"] = round(s["worked_minutes"] / s["scheduled_minutes"] * 100, 1) if s["scheduled_minutes"] else None
    return s


@router.get("/timesheet/employee/{employee_id}", response_model=EmployeeTimesheetOut)
async def employee_timesheet(employee_id: int, p: Auth, db: DB, year: int, month: int, sync_fines: bool = True):
    emp = await get_employee_or_404(db, p.project.id, employee_id)
    start, end = month_bounds(year, month)
    ts = TimesheetService(db, p.project)
    result = await ts.recompute_employee(emp, start, end)
    rows = {d: r for d, (r, _) in result.items()}
    if sync_fines and merged_settings(p.project.settings).get("finance_enabled", True):
        await PayrollService(db, p.project).sync_auto_fines(emp, rows, datetime.now(ts.tz).date())
    await db.commit()
    all_events = await db.execute(
        select(AttendanceEvent).where(AttendanceEvent.employee_id == emp.id,
                                      AttendanceEvent.event_time >= datetime.combine(start, time.min, ts.tz) - timedelta(days=1),
                                      AttendanceEvent.event_time <= datetime.combine(end, time.max, ts.tz) + timedelta(days=1))
        .order_by(AttendanceEvent.event_time)
    )
    close_hour = int(ts.settings.get("day_close_hour", 0) or 0)
    by_day: dict[date, list[AttendanceEvent]] = defaultdict(list)
    for ev in all_events.scalars():
        by_day[business_date_for(ev.event_time.astimezone(ts.tz), close_hour)].append(ev)
    holidays = {h.date: h.name for h in (await db.execute(select(Holiday).where(Holiday.project_id == p.project.id, Holiday.date >= start, Holiday.date <= end))).scalars()}
    schedules = {s.id: s for s in (await db.execute(select(Schedule).where(Schedule.project_id == p.project.id))).scalars()}
    days = [await _day_out(rows[d], by_day.get(d, []), holidays, schedules) for d in sorted(rows)]
    return EmployeeTimesheetOut(employee=emp_out(emp), year=year, month=month, days=days, summary=summarize(list(rows.values())))


@router.get("/timesheet/summary")
async def timesheet_summary(p: Auth, db: DB, date_from: date, date_to: date, department_id: int | None = None):
    if date_to < date_from or (date_to - date_from).days > 92:
        raise HTTPException(400, "Период до 3 месяцев")
    employees = await active_employees(db, p, department_id=department_id)
    ts = TimesheetService(db, p.project)
    result = await ts.recompute(employees, date_from, date_to)
    await db.commit()
    holidays = {h.date: h.name for h in (await db.execute(select(Holiday).where(Holiday.project_id == p.project.id, Holiday.date >= date_from, Holiday.date <= date_to))).scalars()}
    events = await ts.events_by_day([e.id for e in employees], date_from, date_to)
    schedules = {s.id: s for s in (await db.execute(select(Schedule).where(Schedule.project_id == p.project.id))).scalars()}
    items, totals = [], {"scheduled_minutes": 0, "worked_minutes": 0, "late": 0, "early_leave": 0, "absent": 0, "employees": len(employees)}
    tz = ts.tz
    for emp in employees:
        rows = [result[(emp.id, date_from + timedelta(days=i))][0] for i in range((date_to - date_from).days + 1)]
        s = summarize(rows)
        for k in ("scheduled_minutes", "worked_minutes", "late", "early_leave", "absent"):
            totals[k] += s[k]
        items.append({
            "employee": emp_out(emp).model_dump(), "summary": s,
            "days": [(await _day_out(r, events.get((emp.id, r.date), []), holidays, schedules)).model_dump() for r in rows],
        })
    return {"date_from": date_from.isoformat(), "date_to": date_to.isoformat(), "totals": totals, "items": items,
            "event_count": sum(len(v) for v in events.values())}


# ------------------------------------------------------------------ day editing


def _parse_status(value: str | None) -> DayStatus | None:
    if not value:
        return None
    try:
        return DayStatus(value)
    except ValueError:
        raise HTTPException(400, f"Неизвестный статус {value}")


@router.get("/attendance/day")
async def get_day(p: Auth, db: DB, employee_id: int, day: date = Query(alias="date")):
    data = await employee_timesheet(employee_id, p, db, day.year, day.month, sync_fines=False)
    for d in data.days:
        if d.date == day:
            return d
    raise HTTPException(404)


@router.put("/attendance/day")
async def edit_day(data: DayEditIn, p: AdminOrHr, db: DB, request: Request, employee_id: int, day: date = Query(alias="date")):
    emp = await get_employee_or_404(db, p.project.id, employee_id)
    row = (await db.execute(select(AttendanceDay).where(AttendanceDay.employee_id == emp.id, AttendanceDay.date == day))).scalar_one_or_none()
    if row is None:
        row = AttendanceDay(project_id=p.project.id, employee_id=emp.id, date=day)
        db.add(row)
    before = f"{STATUS_LABELS.get(row.status.value, row.status.value)}"

    if data.reset:
        row.is_manual, row.manual_status, row.manual_check_in, row.manual_check_out = False, None, None, None
        row.schedule_id, row.day_off_override, row.comment = None, False, ""
    else:
        if data.hidden_event_ids or data.unhidden_event_ids or data.flip_event_ids:
            ids = set(data.hidden_event_ids) | set(data.unhidden_event_ids) | set(data.flip_event_ids)
            evs = (await db.execute(select(AttendanceEvent).where(AttendanceEvent.id.in_(ids), AttendanceEvent.employee_id == emp.id))).scalars().all()
            for ev in evs:
                if ev.id in data.hidden_event_ids:
                    ev.hidden = True
                if ev.id in data.unhidden_event_ids:
                    ev.hidden = False
                if ev.id in data.flip_event_ids:
                    ev.direction = EventDirection.check_out if ev.direction == EventDirection.check_in else EventDirection.check_in
        status = _parse_status(data.status)
        if status is not None or data.check_in or data.check_out:
            row.is_manual = True
            row.manual_status = status
            row.manual_check_in = data.check_in
            row.manual_check_out = data.check_out
        if data.schedule_id is not None:
            row.schedule_id = data.schedule_id or None
        if data.day_off_override is not None:
            row.day_off_override = data.day_off_override
        row.comment = data.comment or row.comment
    row.edited_by = p.username

    ts = TimesheetService(db, p.project)
    result = await ts.recompute_employee(emp, day, day)
    new_row = result[day][0]
    await PayrollService(db, p.project).sync_auto_fines(emp, {day: new_row}, datetime.now(ts.tz).date())
    after = STATUS_LABELS.get(new_row.status.value, new_row.status.value)
    times = ""
    if new_row.check_in:
        times = f", вход {new_row.check_in.astimezone(ts.tz):%H:%M}"
        if new_row.check_out:
            times = f", {new_row.check_in.astimezone(ts.tz):%H:%M}–{new_row.check_out.astimezone(ts.tz):%H:%M}"
    await log_action(db, project_id=p.project.id, actor=p.username, category="attendance", action="attendance_edit",
                     details=f"Табель {emp.full_name} ({day:%d.%m.%Y}): {before} → {after}{times}. {data.comment}".strip(),
                     entity_type="employee", entity_id=emp.id, request=request)
    await db.commit()
    return await get_day(p, db, employee_id, day)


@router.post("/attendance/days/bulk")
async def bulk_edit(data: BulkDayEditIn, p: AdminOrHr, db: DB, request: Request):
    status = _parse_status(data.status)
    ts = TimesheetService(db, p.project)
    pay = PayrollService(db, p.project)
    for emp_id in data.employee_ids:
        emp = await get_employee_or_404(db, p.project.id, emp_id)
        for day in data.dates:
            row = (await db.execute(select(AttendanceDay).where(AttendanceDay.employee_id == emp.id, AttendanceDay.date == day))).scalar_one_or_none()
            if row is None:
                row = AttendanceDay(project_id=p.project.id, employee_id=emp.id, date=day)
                db.add(row)
            row.is_manual, row.manual_status, row.comment, row.edited_by = True, status, data.comment, p.username
        await db.flush()
        res = await ts.recompute_employee(emp, min(data.dates), max(data.dates))
        await pay.sync_auto_fines(emp, {d: r for d, (r, _) in res.items()}, datetime.now(ts.tz).date())
    await log_action(db, project_id=p.project.id, actor=p.username, category="attendance", action="attendance_bulk",
                     details=f"Массовая правка: {len(data.employee_ids)} сотр. × {len(data.dates)} дн. → {STATUS_LABELS.get(data.status, data.status)}", request=request)
    await db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ raw events


@router.get("/employees/{employee_id}/pass-log", response_model=list[EventOut])
async def pass_log(employee_id: int, p: Auth, db: DB, year: int, month: int):
    emp = await get_employee_or_404(db, p.project.id, employee_id)
    ts = TimesheetService(db, p.project)
    start, end = month_bounds(year, month)
    rows = await db.execute(
        select(AttendanceEvent).where(AttendanceEvent.employee_id == emp.id,
                                      AttendanceEvent.event_time >= datetime.combine(start, time.min, ts.tz),
                                      AttendanceEvent.event_time <= datetime.combine(end, time.max, ts.tz) + timedelta(hours=8))
        .order_by(AttendanceEvent.event_time.desc())
    )
    return [_ev_out(e, emp.full_name) for e in rows.scalars()]


@router.post("/attendance/events", response_model=EventOut, status_code=201)
async def manual_event(data: ManualEventIn, p: AdminOrHr, db: DB, request: Request):
    emp = await get_employee_or_404(db, p.project.id, data.employee_id)
    ev = AttendanceEvent(project_id=p.project.id, employee_id=emp.id, event_time=data.event_time,
                         direction=EventDirection(data.direction), source=EventSource.manual, device_label=f"Вручную · {p.username}")
    db.add(ev)
    await db.flush()
    ts = TimesheetService(db, p.project)
    day = business_date_for(data.event_time.astimezone(ts.tz), int(ts.settings.get("day_close_hour", 0) or 0))
    res = await ts.recompute_employee(emp, day, day)
    await PayrollService(db, p.project).sync_auto_fines(emp, {day: res[day][0]}, datetime.now(ts.tz).date())
    await log_action(db, project_id=p.project.id, actor=p.username, category="attendance", action="manual_event",
                     details=f"Ручная отметка {emp.full_name}: {'вход' if data.direction == 'in' else 'выход'} {data.event_time.astimezone(ts.tz):%d.%m.%Y %H:%M}. {data.comment}".strip(),
                     entity_type="employee", entity_id=emp.id, request=request)
    await db.commit()
    return _ev_out(ev, emp.full_name)


@router.delete("/attendance/events/{event_id}", status_code=204)
async def delete_event(event_id: int, p: AdminOrHr, db: DB):
    ev = await db.get(AttendanceEvent, event_id)
    if not ev or ev.project_id != p.project.id:
        raise HTTPException(404)
    if ev.source == EventSource.terminal:
        ev.hidden = True  # never lose terminal data; just exclude it
    else:
        await db.delete(ev)
    await db.commit()


@router.get("/attendance/passes")
async def recent_passes(p: Auth, db: DB, limit: int = 20):
    """Who is inside now + last passes (dashboard widget)."""
    ts = TimesheetService(db, p.project)
    today = datetime.now(ts.tz).date()
    employees = await active_employees(db, p)
    res = await ts.recompute(employees, today, today, persist=False)
    items = []
    for emp in employees:
        row, _ = res[(emp.id, today)]
        if not row.check_in:
            continue
        items.append({"employee_id": emp.id, "employee_name": emp.full_name, "avatar_url": public_url(emp.avatar_path),
                      "check_in_at": row.check_in, "check_out_at": row.check_out,
                      "duration_minutes": row.worked_minutes if row.check_out else None,
                      "is_inside": row.check_out is None, "is_remote": emp.work_mode.value == "remote"})
    items.sort(key=lambda x: x["check_in_at"], reverse=True)
    inside = sum(1 for i in items if i["is_inside"])
    return {"inside_now": inside, "at_work_now": inside, "left_today": len(items) - inside, "passes": items[:limit]}
