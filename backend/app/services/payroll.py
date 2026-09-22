"""Payroll: earned salary per period, transactions, auto-fines."""

from __future__ import annotations

import calendar
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.project_settings import merged_settings
from app.models import (
    AttendanceDay,
    DayStatus,
    Employee,
    PayrollTransaction,
    PieceworkEntry,
    Project,
    RateType,
    SalaryRate,
    TxType,
)
from app.services.timesheet import TimesheetService

D = Decimal
TWO = D("0.01")

NON_WORK_STATUSES = {DayStatus.day_off, DayStatus.holiday, DayStatus.planned, DayStatus.not_hired, DayStatus.dismissed}


def month_bounds(year: int, month: int) -> tuple[date, date]:
    return date(year, month, 1), date(year, month, calendar.monthrange(year, month)[1])


def rate_on(employee: Employee, day: date) -> SalaryRate | None:
    """Effective salary rate for a day (rates sorted desc by effective_from)."""
    for r in employee.salary_rates:
        if r.effective_from <= day:
            return r
    return None


@dataclass
class EarnedSummary:
    employee_id: int
    rate_type: str | None
    rate_amount: Decimal
    worked_minutes: int = 0
    scheduled_minutes: int = 0
    overtime_minutes: int = 0
    scheduled_days: int = 0
    worked_days: int = 0
    late_count: int = 0
    early_count: int = 0
    absent_count: int = 0
    excused_count: int = 0
    units: Decimal = D(0)  # выработка сдельщика за период
    earned: Decimal = D(0)
    overtime_pay: Decimal = D(0)
    bonuses: Decimal = D(0)
    fines: Decimal = D(0)
    accrued: Decimal = D(0)
    paid: Decimal = D(0)
    days: list[dict] = field(default_factory=list)

    @property
    def total(self) -> Decimal:
        return (self.earned + self.overtime_pay + self.bonuses - self.fines).quantize(TWO)

    @property
    def to_pay(self) -> Decimal:
        return (self.accrued + self.bonuses - self.fines - self.paid).quantize(TWO)


class PayrollService:
    def __init__(self, db: AsyncSession, project: Project):
        self.db = db
        self.project = project
        self.settings = merged_settings(project.settings)

    # ---------------------------------------------------------------- earned salary

    async def earned(self, employee: Employee, start: date, end: date, recompute: bool = True) -> EarnedSummary:
        ts = TimesheetService(self.db, self.project)
        if recompute:
            days = await ts.recompute_employee(employee, start, end)
            rows = {d: r for d, (r, _) in days.items()}
        else:
            res = await ts.existing_days([employee.id], start, end)
            rows = {d: r for (_, d), r in res.items()}

        rate = rate_on(employee, end) or rate_on(employee, start)
        s = EarnedSummary(employee.id, rate.rate_type.value if rate else None, D(str(rate.amount)) if rate else D(0))

        for d in sorted(rows):
            r = rows[d]
            s.days.append({"date": d.isoformat(), "status": r.status.value, "worked": r.worked_minutes,
                           "scheduled": r.scheduled_minutes, "late": r.late_minutes, "overtime": r.overtime_minutes})
            if r.status not in NON_WORK_STATUSES:
                if r.scheduled_minutes:
                    s.scheduled_days += 1
                    s.scheduled_minutes += r.scheduled_minutes
                s.overtime_minutes += r.overtime_minutes
                if r.status == DayStatus.absent:
                    s.absent_count += 1
                elif r.status == DayStatus.excused:
                    s.excused_count += 1
                if r.late_minutes:
                    s.late_count += 1
                if r.early_leave_minutes:
                    s.early_count += 1
                if r.worked_minutes:
                    s.worked_days += 1
                    # "full day by minimum" — if threshold reached, the day counts as full for salary
                    sched = employee.schedule
                    if (r.scheduled_minutes and sched and sched.full_day_threshold_min
                            and r.worked_minutes >= sched.full_day_threshold_min):
                        s.worked_minutes += max(r.worked_minutes, r.scheduled_minutes)
                    else:
                        s.worked_minutes += r.worked_minutes

        if rate:
            if rate.rate_type == RateType.piece:
                # сдельная: ставка за единицу × выработка за период; часы не влияют
                units = await self.db.scalar(
                    select(func.coalesce(func.sum(PieceworkEntry.quantity), 0)).where(
                        PieceworkEntry.employee_id == employee.id, PieceworkEntry.work_date >= start, PieceworkEntry.work_date <= end))
                s.units = D(str(units or 0))
                s.earned = (s.rate_amount * s.units).quantize(TWO)
                hourly = D(0)
            elif rate.rate_type == RateType.hourly:
                s.earned = (s.rate_amount * D(s.worked_minutes) / D(60)).quantize(TWO)
                hourly = s.rate_amount
            else:
                # monthly salary pro-rated by worked / scheduled minutes of the period;
                # rest days per month reduce the norm
                sched = employee.schedule
                norm_minutes = s.scheduled_minutes
                if sched and sched.rest_days_per_month and sched.start_time:
                    from app.services.timesheet import schedule_net_minutes
                    norm_minutes = max(norm_minutes - sched.rest_days_per_month * schedule_net_minutes(sched), 0)
                if norm_minutes > 0:
                    paid_minutes = min(s.worked_minutes, norm_minutes) if not s.overtime_minutes else min(s.worked_minutes, norm_minutes)
                    s.earned = (s.rate_amount * D(paid_minutes) / D(norm_minutes)).quantize(TWO)
                    hourly = (s.rate_amount / D(norm_minutes) * D(60)).quantize(TWO)
                else:
                    # flexible employee on monthly rate: full salary if worked anything
                    s.earned = s.rate_amount if s.worked_minutes else D(0)
                    hourly = D(0)
            sched = employee.schedule
            if sched and sched.overtime_mode.value != "none" and s.overtime_minutes:
                pct = D(sched.weekday_rate_pct or 100) / D(100)
                base = D(str(sched.overtime_hour_amount)) if sched.overtime_hour_amount else hourly
                s.overtime_pay = (base * pct * D(s.overtime_minutes) / D(60)).quantize(TWO)

        s.bonuses, s.fines, s.accrued, s.paid = await self.transaction_totals(employee.id, start, end)
        return s

    async def transaction_totals(self, employee_id: int, start: date, end: date) -> tuple[Decimal, Decimal, Decimal, Decimal]:
        rows = await self.db.execute(
            select(PayrollTransaction.type, func.coalesce(func.sum(PayrollTransaction.amount), 0))
            .where(
                PayrollTransaction.employee_id == employee_id,
                PayrollTransaction.deleted_at.is_(None),
                PayrollTransaction.tx_date >= start,
                PayrollTransaction.tx_date <= end,
            )
            .group_by(PayrollTransaction.type)
        )
        totals = {t: D(str(v)) for t, v in rows}
        return (totals.get(TxType.bonus, D(0)), totals.get(TxType.fine, D(0)),
                totals.get(TxType.salary, D(0)), totals.get(TxType.payment, D(0)))

    # ---------------------------------------------------------------- transactions

    async def add_transaction(
        self, employee: Employee, tx_type: TxType, amount: Decimal | float, tx_date: date,
        reason: str = "", comment: str = "", created_by: str = "admin", auto_key: str | None = None, meta: dict | None = None,
    ) -> PayrollTransaction:
        tx = PayrollTransaction(
            project_id=self.project.id, employee_id=employee.id, type=tx_type, amount=D(str(amount)).quantize(TWO),
            tx_date=tx_date, period_year=tx_date.year, period_month=tx_date.month, reason=reason, comment=comment,
            created_by=created_by, auto_key=auto_key, meta=meta or {},
        )
        self.db.add(tx)
        await self.db.flush()
        return tx

    async def accrue_salary(self, employee: Employee, year: int, month: int, actor: str) -> tuple[PayrollTransaction, EarnedSummary]:
        """Create or replace the month salary accrual (idempotent per employee+month)."""
        start, end = month_bounds(year, month)
        summary = await self.earned(employee, start, end)
        key = f"salary:{year:04d}-{month:02d}"
        existing = (await self.db.execute(
            select(PayrollTransaction).where(PayrollTransaction.employee_id == employee.id, PayrollTransaction.auto_key == key)
        )).scalar_one_or_none()
        amount = (summary.earned + summary.overtime_pay).quantize(TWO)
        desc = f"Начисление ({summary.worked_minutes // 60}:{summary.worked_minutes % 60:02d} / {summary.scheduled_minutes // 60}:{summary.scheduled_minutes % 60:02d} ч)"
        if existing:
            existing.amount = amount
            existing.reason = desc
            existing.deleted_at = None
            existing.created_by = actor
            existing.meta = {"worked_minutes": summary.worked_minutes, "scheduled_minutes": summary.scheduled_minutes}
            tx = existing
        else:
            tx = await self.add_transaction(employee, TxType.salary, amount, end, reason=desc, created_by=actor, auto_key=key,
                                            meta={"worked_minutes": summary.worked_minutes, "scheduled_minutes": summary.scheduled_minutes})
        summary.accrued = amount
        return tx, summary

    # ---------------------------------------------------------------- auto fines

    def _late_fine_amount(self, late_minutes: int) -> Decimal:
        s = self.settings
        amount = D(str(s.get("auto_fine_late_amount") or 0))
        if s.get("auto_fine_late_per_hour"):
            amount += D(str(s.get("auto_fine_late_per_hour_amount") or 0)) * D(late_minutes // 60)
        if s.get("auto_fine_late_per_minute"):
            amount += D(str(s.get("auto_fine_late_per_minute_amount") or 0)) * D(late_minutes)
        return amount.quantize(TWO)

    async def sync_auto_fines(self, employee: Employee, rows: dict[date, AttendanceDay], today: date) -> list[PayrollTransaction]:
        """Ensure auto fines match the computed attendance days; soft-delete stale ones."""
        s = self.settings
        created: list[PayrollTransaction] = []
        enabled = bool(s.get("auto_fines_enabled")) and employee.auto_fines_enabled
        from_date = s.get("auto_fines_from_date")
        from_date = date.fromisoformat(from_date) if isinstance(from_date, str) and from_date else None

        keys = [f"auto:{k}:{d.isoformat()}" for d in rows for k in ("late", "early", "absent")]
        existing = {}
        if keys:
            res = await self.db.execute(
                select(PayrollTransaction).where(PayrollTransaction.employee_id == employee.id, PayrollTransaction.auto_key.in_(keys))
            )
            existing = {t.auto_key: t for t in res.scalars()}

        wanted: dict[str, tuple[Decimal, str]] = {}
        if enabled:
            start_time = None
            for d, r in rows.items():
                if from_date and d < from_date:
                    continue
                if employee.hire_date and d < employee.hire_date:
                    continue
                if r.status in (DayStatus.excused, DayStatus.remote, DayStatus.leave, DayStatus.worked_off) or r.status in NON_WORK_STATUSES:
                    continue
                if r.is_manual and r.manual_status in (DayStatus.excused,):
                    continue
                sched_start = employee.schedule.start_time.strftime("%H:%M") if employee.schedule and employee.schedule.start_time else "—"
                if s.get("auto_fine_late_enabled") and r.late_minutes > 0:
                    came = r.check_in.astimezone(TimesheetService(self.db, self.project).tz).strftime("%H:%M") if r.check_in else "—"
                    h, m = divmod(r.late_minutes, 60)
                    human = f"{h} ч {m} мин" if h else f"{m} мин"
                    wanted[f"auto:late:{d.isoformat()}"] = (
                        self._late_fine_amount(r.late_minutes),
                        f"Автоштраф: опоздание ({d.strftime('%d.%m.%Y')}). По графику нужно в {sched_start}, пришли в {came} — опоздание {human}.",
                    )
                if s.get("auto_fine_early_enabled") and r.early_leave_minutes > 0:
                    wanted[f"auto:early:{d.isoformat()}"] = (
                        D(str(s.get("auto_fine_early_amount") or 0)),
                        f"Автоштраф: ранний уход ({d.strftime('%d.%m.%Y')}) на {r.early_leave_minutes} мин.",
                    )
                if s.get("auto_fine_absent_enabled") and r.status == DayStatus.absent and d < today:
                    wanted[f"auto:absent:{d.isoformat()}"] = (
                        D(str(s.get("auto_fine_absent_amount") or 0)),
                        f"Автоштраф: отсутствие без уважительной причины ({d.strftime('%d.%m.%Y')}).",
                    )

        for key, (amount, reason) in wanted.items():
            if amount <= 0:
                continue
            day = date.fromisoformat(key.split(":")[-1])
            tx = existing.get(key)
            if tx is None:
                tx = await self.add_transaction(employee, TxType.fine, amount, day, reason=reason, created_by="system", auto_key=key)
                created.append(tx)
            else:
                tx.amount, tx.reason, tx.deleted_at = amount, reason, None
        for key, tx in existing.items():
            if key not in wanted and tx.deleted_at is None:
                tx.deleted_at = datetime.now(timezone.utc)
                tx.deleted_by = "system"
        await self.db.flush()
        return created
