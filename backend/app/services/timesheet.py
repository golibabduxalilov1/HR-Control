"""Timesheet engine: turns raw pass events + schedules into per-day attendance records.

Pure functions live in `compute_day`; DB orchestration in `TimesheetService`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import and_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.project_settings import merged_settings
from app.models import (
    AttendanceDay,
    AttendanceEvent,
    DayStatus,
    Employee,
    EmployeeStatus,
    EventDirection,
    Holiday,
    HoursCalc,
    OvertimeMode,
    Project,
    Schedule,
    ScheduleDayOff,
    ScheduleMode,
    ScheduleType,
)


@dataclass
class DayPlan:
    """What the schedule expects on a given day."""

    schedule: Schedule | None
    is_working: bool
    is_holiday: bool
    is_day_off: bool
    start: time | None
    end: time | None
    scheduled_minutes: int
    reason: str = ""


@dataclass
class DayResult:
    status: DayStatus
    check_in: datetime | None = None
    check_out: datetime | None = None
    worked_minutes: int = 0
    scheduled_minutes: int = 0
    overtime_minutes: int = 0
    late_minutes: int = 0
    early_leave_minutes: int = 0
    sessions: list[tuple[datetime, datetime | None]] = field(default_factory=list)
    plan: DayPlan | None = None


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------


def _to_minutes(t: time) -> int:
    return t.hour * 60 + t.minute


def shift_duration_minutes(start: time | None, end: time | None) -> int:
    if not start or not end:
        return 0
    s, e = _to_minutes(start), _to_minutes(end)
    if e <= s:
        e += 24 * 60  # overnight shift
    return e - s


def schedule_net_minutes(schedule: Schedule) -> int:
    """Length of shift minus lunch (lunch is not paid time)."""
    total = shift_duration_minutes(schedule.start_time, schedule.end_time)
    if schedule.lunch_enabled and schedule.lunch_start and schedule.lunch_end:
        total -= shift_duration_minutes(schedule.lunch_start, schedule.lunch_end)
    return max(total, 0)


def business_date_for(event_local: datetime, day_close_hour: int) -> date:
    """Events before `day_close_hour` belong to the previous calendar day (night shifts)."""
    if event_local.hour < day_close_hour:
        return (event_local - timedelta(days=1)).date()
    return event_local.date()


def build_day_plan(
    day: date,
    schedule: Schedule | None,
    schedule_mode: ScheduleMode,
    holidays: set[date],
    day_offs: set[date],
    day_off_override: bool = False,
) -> DayPlan:
    is_holiday = day in holidays
    if schedule is None or schedule_mode == ScheduleMode.flexible or schedule.type == ScheduleType.flexible:
        return DayPlan(schedule, is_working=False, is_holiday=is_holiday, is_day_off=False,
                       start=None, end=None, scheduled_minutes=0, reason="flexible")
    weekday = day.weekday()
    work_days = schedule.work_days or [True] * 7
    is_day_off = day_off_override or (day in day_offs) or not bool(work_days[weekday] if weekday < len(work_days) else True)
    is_working = not is_day_off and not is_holiday
    return DayPlan(
        schedule=schedule,
        is_working=is_working,
        is_holiday=is_holiday,
        is_day_off=is_day_off,
        start=schedule.start_time,
        end=schedule.end_time,
        scheduled_minutes=schedule_net_minutes(schedule) if is_working else 0,
    )


def _round_minutes(minutes: int, rounding: int) -> int:
    if rounding and rounding > 1:
        return int(round(minutes / rounding) * rounding)
    return minutes


def _lunch_overlap(start: datetime, end: datetime, schedule: Schedule | None, tz: ZoneInfo) -> int:
    if not schedule or not schedule.lunch_enabled or not schedule.lunch_start or not schedule.lunch_end:
        return 0
    day = start.astimezone(tz).date()
    ls = datetime.combine(day, schedule.lunch_start, tz)
    le = datetime.combine(day, schedule.lunch_end, tz)
    if le <= ls:
        le += timedelta(days=1)
    overlap = min(end, le) - max(start, ls)
    return max(int(overlap.total_seconds() // 60), 0)


def compute_day(
    day: date,
    events: list[AttendanceEvent],
    plan: DayPlan,
    tz: ZoneInfo,
    now: datetime,
    settings: dict,
    employee: Employee,
    manual_status: DayStatus | None = None,
    manual_in: datetime | None = None,
    manual_out: datetime | None = None,
) -> DayResult:
    """Compute one day for one employee. `events` must be non-hidden, sorted, for this business date."""

    res = DayResult(status=DayStatus.absent, scheduled_minutes=plan.scheduled_minutes, plan=plan)

    # employment window
    if employee.hire_date and day < employee.hire_date:
        res.status = DayStatus.not_hired
        res.scheduled_minutes = 0
        return res
    if employee.status == EmployeeStatus.dismissed and employee.dismiss_date and day > employee.dismiss_date:
        res.status = DayStatus.dismissed
        res.scheduled_minutes = 0
        return res

    schedule = plan.schedule
    include_lunch = bool(settings.get("include_lunch")) if plan.is_working else bool(settings.get("flexible_include_lunch"))
    rounding = int(schedule.rounding_min if schedule and schedule.rounding_min else settings.get("time_rounding_min", 0) or 0)

    # --- pair events into sessions -------------------------------------------------
    ins = [e for e in events if e.direction == EventDirection.check_in]
    outs = [e for e in events if e.direction == EventDirection.check_out]
    check_in = manual_in or (ins[0].event_time if ins else (events[0].event_time if events else None))
    check_out = manual_out
    if check_out is None and check_in is not None:
        later_outs = [e.event_time for e in outs if e.event_time > check_in]
        check_out = later_outs[-1] if later_outs else None

    sessions: list[tuple[datetime, datetime | None]] = []
    if manual_in or manual_out:
        sessions = [(check_in, check_out)] if check_in else []
    else:
        open_in: datetime | None = None
        for e in events:
            if e.direction == EventDirection.check_in:
                if open_in is None:
                    open_in = e.event_time
            else:
                if open_in is not None:
                    sessions.append((open_in, e.event_time))
                    open_in = None
        if open_in is not None:
            sessions.append((open_in, None))

    res.check_in, res.check_out, res.sessions = check_in, check_out, sessions

    # --- worked minutes ----------------------------------------------------------------
    worked = 0
    if check_in and check_out and check_out > check_in:
        if schedule and schedule.hours_calc == HoursCalc.sessions and sessions:
            for s, e in sessions:
                if e and e > s:
                    worked += int((e - s).total_seconds() // 60)
                    if not include_lunch:
                        worked -= _lunch_overlap(s, e, schedule, tz)
        else:
            worked = int((check_out - check_in).total_seconds() // 60)
            if not include_lunch:
                worked -= _lunch_overlap(check_in, check_out, schedule, tz)
        worked = max(_round_minutes(worked, rounding), 0)
    res.worked_minutes = worked

    # --- late / early / overtime for scheduled days --------------------------------------
    if plan.is_working and plan.start and plan.end and schedule:
        shift_start = datetime.combine(day, plan.start, tz)
        shift_end = datetime.combine(day, plan.end, tz)
        if shift_end <= shift_start:
            shift_end += timedelta(days=1)
        if check_in:
            delta = int((check_in - shift_start).total_seconds() // 60)
            if delta > schedule.late_grace_min:
                res.late_minutes = delta - schedule.late_grace_min
        if check_out:
            delta = int((shift_end - check_out).total_seconds() // 60)
            if delta > schedule.early_grace_min:
                res.early_leave_minutes = delta - schedule.early_grace_min
        if settings.get("allow_overtime") and schedule.overtime_mode != OvertimeMode.none and check_in and check_out:
            tol = schedule.overtime_tolerance_min or 0
            before = int((shift_start - check_in).total_seconds() // 60) - tol
            after = int((check_out - shift_end).total_seconds() // 60) - tol
            res.overtime_minutes = max(before, 0) + max(after, 0)
    elif (not plan.is_working) and schedule and schedule.overtime_mode == OvertimeMode.full_day and worked:
        res.overtime_minutes = worked  # whole day outside schedule (weekend / holiday)

    # --- status ------------------------------------------------------------------------
    today_local = now.astimezone(tz).date()
    if manual_status is not None:
        res.status = manual_status
        return res

    if not events and not (manual_in or manual_out):
        if plan.reason == "flexible":
            res.status = DayStatus.planned if day > today_local else DayStatus.absent
        elif plan.is_holiday:
            res.status = DayStatus.holiday
        elif plan.is_day_off:
            res.status = DayStatus.day_off
        elif day > today_local:
            res.status = DayStatus.planned
        else:
            res.status = DayStatus.absent
        return res

    if not plan.is_working:
        res.status = DayStatus.worked_off  # came on a day off / holiday / flexible
        return res

    if res.late_minutes and res.early_leave_minutes:
        res.status = DayStatus.late_early
    elif res.late_minutes:
        res.status = DayStatus.late
    elif res.early_leave_minutes:
        res.status = DayStatus.early_leave
    else:
        res.status = DayStatus.on_time
    return res


# ---------------------------------------------------------------------------
# DB orchestration
# ---------------------------------------------------------------------------


class TimesheetService:
    def __init__(self, db: AsyncSession, project: Project):
        self.db = db
        self.project = project
        self.settings = merged_settings(project.settings)
        self.tz = ZoneInfo(project.timezone or "Asia/Tashkent")

    # -- loaders -------------------------------------------------------------------------

    async def holidays(self, start: date, end: date) -> set[date]:
        rows = await self.db.execute(
            select(Holiday.date).where(Holiday.project_id == self.project.id, Holiday.date >= start, Holiday.date <= end)
        )
        return {r[0] for r in rows}

    async def day_offs(self, schedule_ids: list[int], start: date, end: date) -> dict[int, set[date]]:
        if not schedule_ids:
            return {}
        rows = await self.db.execute(
            select(ScheduleDayOff.schedule_id, ScheduleDayOff.date).where(
                ScheduleDayOff.schedule_id.in_(schedule_ids), ScheduleDayOff.date >= start, ScheduleDayOff.date <= end
            )
        )
        out: dict[int, set[date]] = {}
        for sid, d in rows:
            out.setdefault(sid, set()).add(d)
        return out

    async def events_by_day(self, employee_ids: list[int], start: date, end: date) -> dict[tuple[int, date], list[AttendanceEvent]]:
        if not employee_ids:
            return {}
        close_hour = int(self.settings.get("day_close_hour", 0) or 0)
        # widen window to catch events of the last day that fall after midnight
        win_start = datetime.combine(start, time.min, self.tz)
        win_end = datetime.combine(end + timedelta(days=1), time(hour=close_hour), self.tz) + timedelta(hours=1)
        rows = await self.db.execute(
            select(AttendanceEvent)
            .where(
                AttendanceEvent.employee_id.in_(employee_ids),
                AttendanceEvent.hidden.is_(False),
                AttendanceEvent.event_time >= win_start,
                AttendanceEvent.event_time <= win_end,
            )
            .order_by(AttendanceEvent.event_time)
        )
        out: dict[tuple[int, date], list[AttendanceEvent]] = {}
        for ev in rows.scalars():
            local = ev.event_time.astimezone(self.tz)
            bday = business_date_for(local, close_hour)
            if start <= bday <= end:
                out.setdefault((ev.employee_id, bday), []).append(ev)
        return out

    async def existing_days(self, employee_ids: list[int], start: date, end: date) -> dict[tuple[int, date], AttendanceDay]:
        if not employee_ids:
            return {}
        rows = await self.db.execute(
            select(AttendanceDay).where(
                AttendanceDay.employee_id.in_(employee_ids), AttendanceDay.date >= start, AttendanceDay.date <= end
            )
        )
        return {(r.employee_id, r.date): r for r in rows.scalars()}

    # -- main entry ----------------------------------------------------------------------

    async def recompute(
        self, employees: list[Employee], start: date, end: date, persist: bool = True
    ) -> dict[tuple[int, date], tuple[AttendanceDay, DayResult]]:
        """Recompute day records for employees in [start, end]. Returns (row, result) per (employee, day)."""
        if not persist:
            return await self._recompute(employees, start, end, persist=False)
        # Materialised rows are committed right away so concurrent requests can see them.
        # A concurrent insert of the same (employee, date) surfaces as IntegrityError: reload and retry once.
        try:
            out = await self._recompute(employees, start, end, persist=True)
            await self.db.commit()
            return out
        except IntegrityError:
            await self.db.rollback()
            for emp in employees:
                await self.db.refresh(emp)
            out = await self._recompute(employees, start, end, persist=True)
            await self.db.commit()
            return out

    async def _recompute(
        self, employees: list[Employee], start: date, end: date, persist: bool = True
    ) -> dict[tuple[int, date], tuple[AttendanceDay, DayResult]]:
        emp_ids = [e.id for e in employees]
        schedule_ids = list({s for e in employees for s in (e.schedule_id, e.night_schedule_id) if s})
        holidays = await self.holidays(start, end)
        existing = await self.existing_days(emp_ids, start, end)
        override_ids = [r.schedule_id for r in existing.values() if r.schedule_id]
        day_offs = await self.day_offs(list(set(schedule_ids + override_ids)), start, end)
        events = await self.events_by_day(emp_ids, start, end)
        schedules: dict[int, Schedule] = {}
        if schedule_ids or override_ids:
            rows = await self.db.execute(select(Schedule).where(Schedule.id.in_(set(schedule_ids + override_ids))))
            schedules = {s.id: s for s in rows.scalars()}
        now = datetime.now(self.tz)

        out: dict[tuple[int, date], tuple[AttendanceDay, DayResult]] = {}
        for emp in employees:
            day = start
            while day <= end:
                row = existing.get((emp.id, day))
                sched_id = (row.schedule_id if row and row.schedule_id else emp.schedule_id)
                schedule = schedules.get(sched_id) if sched_id else None
                plan = build_day_plan(
                    day, schedule, emp.schedule_mode, holidays,
                    day_offs.get(sched_id, set()) if sched_id else set(),
                    day_off_override=bool(row and row.day_off_override),
                )
                result = compute_day(
                    day, events.get((emp.id, day), []), plan, self.tz, now, self.settings, emp,
                    manual_status=row.manual_status if row and row.is_manual else None,
                    manual_in=row.manual_check_in if row and row.is_manual else None,
                    manual_out=row.manual_check_out if row and row.is_manual else None,
                )
                if row is None:
                    row = AttendanceDay(project_id=self.project.id, employee_id=emp.id, date=day)
                    if persist:
                        self.db.add(row)
                row.status = result.status
                row.check_in, row.check_out = result.check_in, result.check_out
                row.worked_minutes = result.worked_minutes
                row.scheduled_minutes = result.scheduled_minutes
                row.overtime_minutes = result.overtime_minutes
                row.late_minutes, row.early_leave_minutes = result.late_minutes, result.early_leave_minutes
                out[(emp.id, day)] = (row, result)
                day += timedelta(days=1)
        if persist:
            await self.db.flush()
        return out

    async def recompute_employee(self, employee: Employee, start: date, end: date) -> dict[date, tuple[AttendanceDay, DayResult]]:
        res = await self.recompute([employee], start, end)
        return {d: v for (_, d), v in res.items()}
