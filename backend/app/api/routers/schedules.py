from datetime import date

from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import selectinload

from app.core.deps import DB, AdminOnly, Auth
from app.models import Employee, Holiday, HoursCalc, OvertimeMode, Schedule, ScheduleDayOff, ScheduleType
from app.schemas import AssignEmployeesIn, DayOffIn, HolidayIn, HolidayOut, ScheduleIn, ScheduleOut
from app.services.audit import log_action

router = APIRouter(tags=["schedules"])

UZ_HOLIDAYS = [
    ((1, 1), "Новый год"), ((3, 8), "Международный женский день"), ((3, 21), "Навруз"),
    ((5, 9), "День памяти и почестей"), ((9, 1), "День независимости"),
    ((10, 1), "День учителя и наставника"), ((12, 8), "День Конституции"),
]


def to_out(s: Schedule, count: int = 0) -> ScheduleOut:
    return ScheduleOut(
        id=s.id, name=s.name, code=s.code, color=s.color, type=s.type.value, status=s.status,
        start_time=s.start_time, end_time=s.end_time, lunch_enabled=s.lunch_enabled, lunch_start=s.lunch_start, lunch_end=s.lunch_end,
        late_grace_min=s.late_grace_min, early_grace_min=s.early_grace_min, work_days=s.work_days or [True] * 7,
        rest_days_per_month=s.rest_days_per_month, full_day_threshold_min=s.full_day_threshold_min, hours_calc=s.hours_calc.value,
        rounding_min=s.rounding_min, overtime_mode=s.overtime_mode.value, overtime_tolerance_min=s.overtime_tolerance_min,
        weekday_rate_pct=s.weekday_rate_pct, weekend_rate_pct=s.weekend_rate_pct, overtime_hour_amount=s.overtime_hour_amount,
        employee_count=count, day_offs=sorted(d.date for d in s.day_offs),
    )


def _apply(s: Schedule, data: ScheduleIn):
    for f in ("name", "code", "color", "status", "start_time", "end_time", "lunch_enabled", "lunch_start", "lunch_end",
              "late_grace_min", "early_grace_min", "work_days", "rest_days_per_month", "full_day_threshold_min",
              "rounding_min", "overtime_tolerance_min", "weekday_rate_pct", "weekend_rate_pct", "overtime_hour_amount"):
        setattr(s, f, getattr(data, f))
    s.type = ScheduleType(data.type)
    s.hours_calc = HoursCalc(data.hours_calc)
    s.overtime_mode = OvertimeMode(data.overtime_mode)
    if s.type != ScheduleType.flexible and (not s.start_time or not s.end_time):
        raise HTTPException(400, "Укажите начало и конец смены")


async def _counts(db, project_id: int) -> dict[int, int]:
    rows = await db.execute(
        select(Employee.schedule_id, func.count(Employee.id)).where(Employee.project_id == project_id, Employee.deleted_at.is_(None)).group_by(Employee.schedule_id)
    )
    return {k: v for k, v in rows if k}


@router.get("/schedules", response_model=list[ScheduleOut])
async def list_schedules(p: Auth, db: DB):
    counts = await _counts(db, p.project.id)
    rows = (await db.execute(select(Schedule).options(selectinload(Schedule.day_offs)).where(Schedule.project_id == p.project.id).order_by(Schedule.id))).scalars().all()
    return [to_out(s, counts.get(s.id, 0)) for s in rows]


@router.post("/schedules", response_model=ScheduleOut, status_code=201)
async def create_schedule(data: ScheduleIn, p: AdminOnly, db: DB, request: Request):
    s = Schedule(project_id=p.project.id)
    _apply(s, data)
    db.add(s)
    await db.flush()
    await log_action(db, project_id=p.project.id, actor=p.username, category="schedules", action="schedule_create",
                     details=f"Создан график «{s.name}»", request=request)
    await db.commit()
    s = (await db.execute(select(Schedule).options(selectinload(Schedule.day_offs)).where(Schedule.id == s.id))).scalar_one()
    return to_out(s)


@router.put("/schedules/{sid}", response_model=ScheduleOut)
async def update_schedule(sid: int, data: ScheduleIn, p: AdminOnly, db: DB, request: Request):
    s = (await db.execute(select(Schedule).options(selectinload(Schedule.day_offs)).where(Schedule.id == sid, Schedule.project_id == p.project.id))).scalar_one_or_none()
    if not s:
        raise HTTPException(404)
    _apply(s, data)
    await log_action(db, project_id=p.project.id, actor=p.username, category="schedules", action="schedule_update",
                     details=f"Изменён график «{s.name}»", request=request)
    await db.commit()
    counts = await _counts(db, p.project.id)
    return to_out(s, counts.get(s.id, 0))


@router.delete("/schedules/{sid}", status_code=204)
async def delete_schedule(sid: int, p: AdminOnly, db: DB, request: Request):
    s = await db.get(Schedule, sid)
    if not s or s.project_id != p.project.id:
        raise HTTPException(404)
    await db.execute(update(Employee).where(Employee.schedule_id == sid).values(schedule_id=None))
    await db.execute(update(Employee).where(Employee.night_schedule_id == sid).values(night_schedule_id=None))
    await db.delete(s)
    await log_action(db, project_id=p.project.id, actor=p.username, category="schedules", action="schedule_delete",
                     details=f"Удалён график «{s.name}»", request=request)
    await db.commit()


@router.post("/schedules/{sid}/assign")
async def assign_schedule(sid: int, data: AssignEmployeesIn, p: AdminOnly, db: DB, request: Request):
    s = await db.get(Schedule, sid)
    if not s or s.project_id != p.project.id:
        raise HTTPException(404)
    await db.execute(update(Employee).where(Employee.project_id == p.project.id, Employee.id.in_(data.employee_ids)).values(schedule_id=sid))
    await log_action(db, project_id=p.project.id, actor=p.username, category="schedules", action="schedule_assign",
                     details=f"График «{s.name}» назначен {len(data.employee_ids)} сотрудникам", request=request)
    await db.commit()
    return {"ok": True}


@router.post("/schedules/{sid}/day-offs", response_model=ScheduleOut)
async def add_day_off(sid: int, data: DayOffIn, p: AdminOnly, db: DB):
    s = (await db.execute(select(Schedule).options(selectinload(Schedule.day_offs)).where(Schedule.id == sid, Schedule.project_id == p.project.id))).scalar_one_or_none()
    if not s:
        raise HTTPException(404)
    if all(d.date != data.date for d in s.day_offs):
        s.day_offs.append(ScheduleDayOff(date=data.date))
    await db.commit()
    return to_out(s)


@router.delete("/schedules/{sid}/day-offs/{day}", response_model=ScheduleOut)
async def remove_day_off(sid: int, day: date, p: AdminOnly, db: DB):
    s = (await db.execute(select(Schedule).options(selectinload(Schedule.day_offs)).where(Schedule.id == sid, Schedule.project_id == p.project.id))).scalar_one_or_none()
    if not s:
        raise HTTPException(404)
    await db.execute(delete(ScheduleDayOff).where(ScheduleDayOff.schedule_id == sid, ScheduleDayOff.date == day))
    await db.commit()
    await db.refresh(s)
    return to_out(s)


# ------------------------------------------------------------------ holidays


@router.get("/holidays", response_model=list[HolidayOut])
async def list_holidays(p: Auth, db: DB, year: int | None = None):
    q = select(Holiday).where(Holiday.project_id == p.project.id)
    if year:
        q = q.where(Holiday.date >= date(year, 1, 1), Holiday.date <= date(year, 12, 31))
    return [HolidayOut.model_validate(h) for h in (await db.execute(q.order_by(Holiday.date))).scalars()]


@router.post("/holidays", response_model=HolidayOut, status_code=201)
async def add_holiday(data: HolidayIn, p: AdminOnly, db: DB):
    exists = (await db.execute(select(Holiday).where(Holiday.project_id == p.project.id, Holiday.date == data.date))).scalar_one_or_none()
    if exists:
        exists.name = data.name
        await db.commit()
        return HolidayOut.model_validate(exists)
    h = Holiday(project_id=p.project.id, date=data.date, name=data.name)
    db.add(h)
    await db.commit()
    return HolidayOut.model_validate(h)


@router.post("/holidays/bulk", response_model=list[HolidayOut])
async def add_holidays_bulk(items: list[HolidayIn], p: AdminOnly, db: DB):
    out = []
    for item in items:
        out.append(await add_holiday(item, p, db))
    return out


@router.post("/holidays/uzbekistan/{year}", response_model=list[HolidayOut])
async def add_uz_holidays(year: int, p: AdminOnly, db: DB):
    return await add_holidays_bulk([HolidayIn(date=date(year, m, d), name=name) for (m, d), name in UZ_HOLIDAYS], p, db)


@router.delete("/holidays/{hid}", status_code=204)
async def delete_holiday(hid: int, p: AdminOnly, db: DB):
    h = await db.get(Holiday, hid)
    if not h or h.project_id != p.project.id:
        raise HTTPException(404)
    await db.delete(h)
    await db.commit()
