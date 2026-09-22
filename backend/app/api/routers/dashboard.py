from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal

from fastapi import APIRouter
from sqlalchemy import func, select

from app.api.routers.attendance import active_employees, problematic_month, recent_passes, today_view
from app.api.routers.employees import stats as employee_stats
from app.core.deps import DB, Auth
from app.core.project_settings import merged_settings
from app.models import AttendanceDay, DayStatus, Employee, PayrollTransaction, TxType
from app.services.payroll import month_bounds
from app.services.timesheet import TimesheetService

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/bootstrap")
async def bootstrap(p: Auth, db: DB, passes_limit: int = 20):
    """Everything the attendance dashboard needs in a single call."""
    today = await today_view(p, db)
    stats = await employee_stats(p, db)
    passes = await recent_passes(p, db, passes_limit)
    problematic = await problematic_month(p, db)

    departments: dict[str, dict] = {}
    for key, bucket in (("present_list", "present"), ("late_list", "late"), ("absent_list", "absent"), ("remote_list", "remote")):
        for item in today[key]:
            name = item.get("department_name") or "—"
            d = departments.setdefault(name, {"department_name": name, "total": 0, "present": 0, "late": 0, "absent": 0, "remote": 0})
            d[bucket] += 1
            d["total"] += 1
    for d in departments.values():
        came = d["present"] + d["late"] + d["remote"]
        d["attendance_rate"] = round(came / d["total"] * 100, 1) if d["total"] else 0
        d["punctuality_rate"] = round(d["present"] / d["total"] * 100, 1) if d["total"] else 0

    return {
        "stats": stats.model_dump(),
        "summary": {k: v for k, v in today.items() if not k.endswith("_list")} | {"departments": sorted(departments.values(), key=lambda x: -x["total"])},
        "passes": passes,
        "problematic": problematic[:10],
    }


@router.get("/kpi")
async def finance_kpi(p: Auth, db: DB):
    """Finance dashboard: fund, fines, bonuses, paid, birthdays, weekly series."""
    ts = TimesheetService(db, p.project)
    today = datetime.now(ts.tz).date()
    start, end = month_bounds(today.year, today.month)
    employees = await active_employees(db, p)
    emp_ids = [e.id for e in employees]

    worked = (await db.execute(select(func.coalesce(func.sum(AttendanceDay.worked_minutes), 0)).where(
        AttendanceDay.employee_id.in_(emp_ids) if emp_ids else False, AttendanceDay.date == today))).scalar_one()
    present = (await db.execute(select(func.count(AttendanceDay.id)).where(
        AttendanceDay.employee_id.in_(emp_ids) if emp_ids else False, AttendanceDay.date == today, AttendanceDay.check_in.isnot(None)))).scalar_one()

    rows = await db.execute(
        select(PayrollTransaction.type, func.coalesce(func.sum(PayrollTransaction.amount), 0))
        .where(PayrollTransaction.project_id == p.project.id, PayrollTransaction.deleted_at.is_(None),
               PayrollTransaction.tx_date >= start, PayrollTransaction.tx_date <= end).group_by(PayrollTransaction.type)
    )
    totals = {t.value: Decimal(str(v)) for t, v in rows}

    # payroll fund = sum of current monthly rates (+ hourly * norm approximated by 176h)
    fund = Decimal(0)
    for e in employees:
        rate = e.salary_rates[0] if e.salary_rates else None
        if rate:
            if rate.rate_type.value == "monthly":
                fund += Decimal(str(rate.amount))
            elif rate.rate_type.value == "hourly":
                fund += Decimal(str(rate.amount)) * 176
            # сдельщики: фонд зависит от выработки, в прогноз не входят

    # weekly payments series (last 8 weeks)
    since = today - timedelta(weeks=8)
    weekly = await db.execute(
        select(PayrollTransaction.tx_date, PayrollTransaction.amount).where(
            PayrollTransaction.project_id == p.project.id, PayrollTransaction.deleted_at.is_(None),
            PayrollTransaction.type == TxType.payment, PayrollTransaction.tx_date >= since)
    )
    buckets: dict[date, Decimal] = defaultdict(Decimal)
    for d, amount in weekly:
        buckets[d - timedelta(days=d.weekday())] += Decimal(str(amount))
    series = [{"week": (since - timedelta(days=since.weekday()) + timedelta(weeks=i)).isoformat(), "amount": 0} for i in range(9)]
    for item in series:
        item["amount"] = float(buckets.get(date.fromisoformat(item["week"]), 0))

    birthdays = []
    for e in employees:
        if not e.birth_date:
            continue
        nxt = e.birth_date.replace(year=today.year)
        if nxt < today:
            nxt = nxt.replace(year=today.year + 1)
        if (nxt - today).days <= 30:
            birthdays.append({"employee_id": e.id, "full_name": e.full_name, "date": nxt.isoformat(), "days_left": (nxt - today).days,
                              "department_name": e.department.name if e.department else None})
    birthdays.sort(key=lambda x: x["days_left"])

    by_dep: dict[str, int] = defaultdict(int)
    for e in employees:
        by_dep[e.department.name if e.department else "—"] += 1

    return {
        "total_employees": len(employees), "present_today": present, "hours_worked": round(worked / 60, 1),
        "payroll_fund": fund, "total_salary": totals.get("salary", 0), "total_fines": totals.get("fine", 0),
        "total_bonuses": totals.get("bonus", 0), "paid_out": totals.get("payment", 0),
        "payments_series": series, "upcoming_birthdays": birthdays,
        "employees_by_department": [{"name": k, "count": v} for k, v in sorted(by_dep.items(), key=lambda x: -x[1])],
    }


@router.get("/analytics")
async def analytics(p: Auth, db: DB, days: int = 30):
    """Attendance trend for the last N days (for charts)."""
    ts = TimesheetService(db, p.project)
    today = datetime.now(ts.tz).date()
    start = today - timedelta(days=days - 1)
    employees = await active_employees(db, p)
    emp_ids = [e.id for e in employees]
    if not emp_ids:
        return {"series": []}
    await ts.recompute(employees, start, today)  # materialise days that were never opened
    rows = await db.execute(
        select(AttendanceDay.date, AttendanceDay.status, func.count(AttendanceDay.id))
        .where(AttendanceDay.employee_id.in_(emp_ids), AttendanceDay.date >= start, AttendanceDay.date <= today)
        .group_by(AttendanceDay.date, AttendanceDay.status)
    )
    per_day: dict[date, dict] = defaultdict(lambda: {"present": 0, "late": 0, "absent": 0})
    for d, status, cnt in rows:
        if status in (DayStatus.on_time, DayStatus.worked_off, DayStatus.remote):
            per_day[d]["present"] += cnt
        elif status in (DayStatus.late, DayStatus.late_early, DayStatus.early_leave):
            per_day[d]["late"] += cnt
        elif status == DayStatus.absent:
            per_day[d]["absent"] += cnt
    series = [{"date": (start + timedelta(days=i)).isoformat(), **per_day[start + timedelta(days=i)]} for i in range(days)]
    return {"series": series, "total_employees": len(employees)}


@router.get("/attention")
async def attention(p: Auth, db: DB):
    """What needs a decision right now: requests, tasks to review, absent/late today, setup gaps."""
    from app.api.routers.requests_tasks import req_out, task_out
    from app.models import AbsenceRequest, RequestStatus, Schedule, Task, TaskStatus

    today = await today_view(p, db)
    reqs = (await db.execute(select(AbsenceRequest, Employee).join(Employee, Employee.id == AbsenceRequest.employee_id)
                             .where(AbsenceRequest.project_id == p.project.id, AbsenceRequest.status == RequestStatus.pending)
                             .order_by(AbsenceRequest.created_at.desc()).limit(10))).unique().all()
    tasks = (await db.execute(select(Task, Employee).join(Employee, Employee.id == Task.employee_id)
                              .where(Task.project_id == p.project.id, Task.status == TaskStatus.review).order_by(Task.completed_at.desc()).limit(10))).unique().all()
    s = merged_settings(p.project.settings)
    emp_count = (await db.execute(select(func.count(Employee.id)).where(Employee.project_id == p.project.id, Employee.deleted_at.is_(None)))).scalar_one()
    sched_count = (await db.execute(select(func.count(Schedule.id)).where(Schedule.project_id == p.project.id))).scalar_one()
    no_schedule = (await db.execute(select(func.count(Employee.id)).where(Employee.project_id == p.project.id, Employee.deleted_at.is_(None),
                                                                           Employee.schedule_id.is_(None), Employee.schedule_mode != "flexible"))).scalar_one()
    setup = {
        "employees": emp_count > 0,
        "schedules": sched_count > 0,
        "schedules_assigned": no_schedule == 0,
        "terminal": bool(s.get("hik_enabled")),
        "telegram": bool(s.get("telegram_bot_token")),
        "auto_fines": bool(s.get("auto_fines_enabled")),
    }
    return {
        "requests": [req_out(r, e).model_dump() for r, e in reqs],
        "tasks": [task_out(t, e).model_dump() for t, e in tasks],
        "late": today["late_list"][:8],
        "absent": today["absent_list"][:8],
        "counts": {"requests": len(reqs), "tasks": len(tasks), "late": today["late"], "absent": today["absent"]},
        "setup": setup,
        "setup_done": all(setup[k] for k in ("employees", "schedules", "schedules_assigned")),
    }


@router.get("/search")
async def global_search(p: Auth, db: DB, q: str):
    """Quick search for the command palette: employees by name / number / phone."""
    from sqlalchemy import or_

    from app.db.session import ci_like

    if len(q.strip()) < 2:
        return {"employees": []}
    rows = (await db.execute(select(Employee).where(Employee.project_id == p.project.id, Employee.deleted_at.is_(None),
                                                    or_(ci_like(Employee.full_name, q), ci_like(Employee.employee_number, q), ci_like(Employee.phone, q)))
                             .order_by(Employee.full_name).limit(8))).scalars().unique().all()
    from app.services.files import public_url

    return {"employees": [{"id": e.id, "full_name": e.full_name, "position": e.position.name if e.position else None,
                           "department": e.department.name if e.department else None, "avatar_url": public_url(e.avatar_path), "status": e.status.value} for e in rows]}
