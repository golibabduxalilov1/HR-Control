"""Pure-function tests for the timesheet engine (no DB)."""

from datetime import date, datetime, time
from types import SimpleNamespace
from zoneinfo import ZoneInfo

from app.models import DayStatus, EmployeeStatus, EventDirection, HoursCalc, OvertimeMode, ScheduleMode, ScheduleType
from app.services.timesheet import build_day_plan, business_date_for, compute_day, schedule_net_minutes

TZ = ZoneInfo("Asia/Tashkent")
NOW = datetime(2026, 9, 18, 15, 0, tzinfo=TZ)
SETTINGS = {"include_lunch": False, "flexible_include_lunch": False, "time_rounding_min": 0, "allow_overtime": True}


def schedule(**kw):
    base = dict(id=1, type=ScheduleType.fixed, start_time=time(8), end_time=time(17), lunch_enabled=True, lunch_start=time(12), lunch_end=time(13),
                late_grace_min=10, early_grace_min=10, work_days=[True] * 6 + [False], rounding_min=0, hours_calc=HoursCalc.first_last,
                overtime_mode=OvertimeMode.none, overtime_tolerance_min=0, rest_days_per_month=0, full_day_threshold_min=None)
    base.update(kw)
    return SimpleNamespace(**base)


def employee(**kw):
    base = dict(id=1, hire_date=date(2026, 1, 1), dismiss_date=None, status=EmployeeStatus.active, schedule_mode=ScheduleMode.fixed)
    base.update(kw)
    return SimpleNamespace(**base)


def ev(h, m, direction="in", day=date(2026, 9, 18)):
    return SimpleNamespace(event_time=datetime.combine(day, time(h, m), TZ), direction=EventDirection.check_in if direction == "in" else EventDirection.check_out, hidden=False)


def plan_for(day=date(2026, 9, 18), sched=None, holidays=(), day_offs=(), mode=ScheduleMode.fixed):
    return build_day_plan(day, sched or schedule(), mode, set(holidays), set(day_offs))


def test_net_minutes_excludes_lunch():
    assert schedule_net_minutes(schedule()) == 8 * 60
    assert schedule_net_minutes(schedule(lunch_enabled=False)) == 9 * 60
    assert schedule_net_minutes(schedule(start_time=time(20), end_time=time(8), lunch_enabled=False)) == 12 * 60  # overnight


def test_business_date_rolls_back_before_close_hour():
    assert business_date_for(datetime(2026, 9, 18, 0, 30, tzinfo=TZ), 6) == date(2026, 9, 17)
    assert business_date_for(datetime(2026, 9, 18, 6, 0, tzinfo=TZ), 6) == date(2026, 9, 18)


def test_on_time_day():
    r = compute_day(date(2026, 9, 18), [ev(7, 58), ev(17, 5, "out")], plan_for(), TZ, NOW, SETTINGS, employee())
    assert r.status == DayStatus.on_time
    assert r.late_minutes == 0 and r.early_leave_minutes == 0
    assert r.worked_minutes == 9 * 60 + 7 - 60  # minus lunch


def test_late_uses_grace():
    r = compute_day(date(2026, 9, 18), [ev(8, 9)], plan_for(), TZ, NOW, SETTINGS, employee())
    assert r.status == DayStatus.on_time  # within 10 min grace
    r = compute_day(date(2026, 9, 18), [ev(13, 25)], plan_for(), TZ, NOW, SETTINGS, employee())
    assert r.status == DayStatus.late
    assert r.late_minutes == 5 * 60 + 25 - 10  # matches the reference system: 5 ч 15 мин


def test_early_leave_and_combined():
    r = compute_day(date(2026, 9, 18), [ev(8, 0), ev(16, 0, "out")], plan_for(), TZ, NOW, SETTINGS, employee())
    assert r.status == DayStatus.early_leave and r.early_leave_minutes == 50
    r = compute_day(date(2026, 9, 18), [ev(9, 0), ev(16, 0, "out")], plan_for(), TZ, NOW, SETTINGS, employee())
    assert r.status == DayStatus.late_early


def test_absent_day_off_holiday_planned():
    assert compute_day(date(2026, 9, 17), [], plan_for(date(2026, 9, 17)), TZ, NOW, SETTINGS, employee()).status == DayStatus.absent
    assert compute_day(date(2026, 9, 20), [], plan_for(date(2026, 9, 20)), TZ, NOW, SETTINGS, employee()).status == DayStatus.day_off  # Sunday
    assert compute_day(date(2026, 9, 1), [], plan_for(date(2026, 9, 1), holidays=[date(2026, 9, 1)]), TZ, NOW, SETTINGS, employee()).status == DayStatus.holiday
    assert compute_day(date(2026, 9, 25), [], plan_for(date(2026, 9, 25)), TZ, NOW, SETTINGS, employee()).status == DayStatus.planned


def test_worked_on_day_off_is_worked_off_and_no_late():
    r = compute_day(date(2026, 9, 20), [ev(12, 0, day=date(2026, 9, 20)), ev(15, 0, "out", day=date(2026, 9, 20))], plan_for(date(2026, 9, 20)), TZ, NOW, SETTINGS, employee())
    assert r.status == DayStatus.worked_off and r.late_minutes == 0 and r.worked_minutes == 180 - 60


def test_flexible_employee_has_no_norm():
    plan = plan_for(sched=schedule(type=ScheduleType.flexible, start_time=None, end_time=None, lunch_enabled=False), mode=ScheduleMode.flexible)
    r = compute_day(date(2026, 9, 18), [ev(10, 0), ev(14, 30, "out")], plan, TZ, NOW, SETTINGS, employee(schedule_mode=ScheduleMode.flexible))
    assert r.status == DayStatus.worked_off and r.scheduled_minutes == 0 and r.worked_minutes == 270


def test_sessions_mode_sums_pairs():
    sched = schedule(hours_calc=HoursCalc.sessions, lunch_enabled=False)
    events = [ev(9, 0), ev(11, 0, "out"), ev(17, 0), ev(20, 0, "out")]
    r = compute_day(date(2026, 9, 18), events, plan_for(sched=sched), TZ, NOW, SETTINGS, employee())
    assert r.worked_minutes == 5 * 60
    r2 = compute_day(date(2026, 9, 18), events, plan_for(sched=schedule(lunch_enabled=False)), TZ, NOW, SETTINGS, employee())
    assert r2.worked_minutes == 11 * 60  # first-last mode


def test_overtime_only_mode():
    sched = schedule(overtime_mode=OvertimeMode.overtime_only, overtime_tolerance_min=15)
    r = compute_day(date(2026, 9, 18), [ev(7, 0), ev(19, 0, "out")], plan_for(sched=sched), TZ, NOW, SETTINGS, employee())
    assert r.overtime_minutes == (60 - 15) + (120 - 15)


def test_manual_override_wins():
    r = compute_day(date(2026, 9, 18), [ev(13, 25)], plan_for(), TZ, NOW, SETTINGS, employee(), manual_status=DayStatus.excused)
    assert r.status == DayStatus.excused
    r = compute_day(date(2026, 9, 18), [], plan_for(), TZ, NOW, SETTINGS, employee(), manual_in=datetime(2026, 9, 18, 9, 0, tzinfo=TZ), manual_out=datetime(2026, 9, 18, 18, 0, tzinfo=TZ))
    assert r.worked_minutes == 8 * 60 and r.status == DayStatus.late


def test_not_hired_and_dismissed():
    assert compute_day(date(2026, 9, 18), [ev(8, 0)], plan_for(), TZ, NOW, SETTINGS, employee(hire_date=date(2026, 10, 1))).status == DayStatus.not_hired
    dismissed = employee(status=EmployeeStatus.dismissed, dismiss_date=date(2026, 9, 1))
    assert compute_day(date(2026, 9, 18), [], plan_for(), TZ, NOW, SETTINGS, dismissed).status == DayStatus.dismissed


def test_rounding():
    r = compute_day(date(2026, 9, 18), [ev(8, 0), ev(17, 3, "out")], plan_for(sched=schedule(rounding_min=15)), TZ, NOW, SETTINGS, employee())
    assert r.worked_minutes == 8 * 60  # 483 → 480
