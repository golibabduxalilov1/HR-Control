from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, HTTPException, Query, Request
from sqlalchemy import func, select

from app.api.routers.attendance import active_employees
from app.api.routers.employees import get_employee_or_404, to_out as emp_out
from app.core.deps import DB, AdminOnly, Auth
from app.core.project_settings import merged_settings
from app.models import Employee, PayrollTransaction, TxType
from app.schemas import AccrueIn, TransactionIn, TransactionOut, TransactionUpdateIn
from app.services.audit import log_action
from app.services.payroll import PayrollService, month_bounds

router = APIRouter(prefix="/payroll", tags=["payroll"])

TX_LABEL = {"salary": "Начисление", "bonus": "Бонус", "fine": "Штраф", "payment": "Выплата"}
TX_SIGN = {"salary": 1, "bonus": 1, "fine": -1, "payment": -1}


def _require_finance(p):
    if not merged_settings(p.project.settings).get("finance_enabled", True):
        raise HTTPException(403, "Финансовый модуль выключен")


def _period(year: int | None, month: int | None, date_from: date | None, date_to: date | None) -> tuple[date, date]:
    if date_from and date_to:
        return date_from, date_to
    today = date.today()
    return month_bounds(year or today.year, month or today.month)


def tx_out(t: PayrollTransaction, emp: Employee | None = None, balance: Decimal | None = None) -> TransactionOut:
    return TransactionOut(
        id=t.id, employee_id=t.employee_id, employee_name=emp.full_name if emp else None,
        department_name=emp.department.name if emp and emp.department else None,
        position_name=emp.position.name if emp and emp.position else None,
        type=t.type.value, amount=t.amount, signed_amount=Decimal(str(t.amount)) * TX_SIGN[t.type.value], tx_date=t.tx_date,
        reason=t.reason, comment=t.comment, auto_key=t.auto_key, created_by=t.created_by, created_at=t.created_at,
        deleted_at=t.deleted_at, balance_after=balance,
    )


@router.get("")
async def payroll_table(p: Auth, db: DB, year: int | None = None, month: int | None = None,
                        date_from: date | None = None, date_to: date | None = None, department_id: int | None = None):
    """Per-employee earned/bonus/fine/total for the period (Расчёты → Зарплата)."""
    _require_finance(p)
    start, end = _period(year, month, date_from, date_to)
    employees = await active_employees(db, p, department_id=department_id)
    svc = PayrollService(db, p.project)
    items, totals = [], {"earned": Decimal(0), "overtime_pay": Decimal(0), "bonuses": Decimal(0), "fines": Decimal(0), "accrued": Decimal(0), "paid": Decimal(0), "total": Decimal(0)}
    for emp in employees:
        s = await svc.earned(emp, start, end)
        item = {
            "employee": emp_out(emp).model_dump(), "rate_type": s.rate_type, "rate_amount": s.rate_amount, "units": s.units,
            "worked_minutes": s.worked_minutes, "scheduled_minutes": s.scheduled_minutes, "overtime_minutes": s.overtime_minutes,
            "scheduled_days": s.scheduled_days, "worked_days": s.worked_days, "late_count": s.late_count, "absent_count": s.absent_count,
            "earned": s.earned, "overtime_pay": s.overtime_pay, "bonuses": s.bonuses, "fines": s.fines, "accrued": s.accrued,
            "paid": s.paid, "total": s.total, "to_pay": s.to_pay,
        }
        for k in totals:
            totals[k] += item[k]
        items.append(item)
    await db.commit()
    return {"date_from": start.isoformat(), "date_to": end.isoformat(), "items": items, "totals": totals}


@router.get("/stats")
async def payroll_stats(p: Auth, db: DB, year: int | None = None, month: int | None = None,
                        date_from: date | None = None, date_to: date | None = None):
    _require_finance(p)
    start, end = _period(year, month, date_from, date_to)
    rows = await db.execute(
        select(PayrollTransaction.type, func.count(PayrollTransaction.id), func.coalesce(func.sum(PayrollTransaction.amount), 0),
               func.count(func.distinct(PayrollTransaction.employee_id)))
        .where(PayrollTransaction.project_id == p.project.id, PayrollTransaction.deleted_at.is_(None),
               PayrollTransaction.tx_date >= start, PayrollTransaction.tx_date <= end)
        .group_by(PayrollTransaction.type)
    )
    out = {t.value: {"count": 0, "sum": Decimal(0), "employees": 0} for t in TxType}
    for t, cnt, total, emps in rows:
        out[t.value] = {"count": cnt, "sum": Decimal(str(total)), "employees": emps}
    # daily series for charts
    daily = await db.execute(
        select(PayrollTransaction.tx_date, PayrollTransaction.type, func.sum(PayrollTransaction.amount))
        .where(PayrollTransaction.project_id == p.project.id, PayrollTransaction.deleted_at.is_(None),
               PayrollTransaction.tx_date >= start, PayrollTransaction.tx_date <= end)
        .group_by(PayrollTransaction.tx_date, PayrollTransaction.type).order_by(PayrollTransaction.tx_date)
    )
    series: dict[str, dict] = {}
    for d, t, total in daily:
        series.setdefault(d.isoformat(), {"date": d.isoformat(), "salary": 0, "bonus": 0, "fine": 0, "payment": 0})[t.value] = float(total)
    # fine reasons breakdown
    reasons = await db.execute(
        select(PayrollTransaction.auto_key, PayrollTransaction.reason, PayrollTransaction.amount)
        .where(PayrollTransaction.project_id == p.project.id, PayrollTransaction.deleted_at.is_(None), PayrollTransaction.type == TxType.fine,
               PayrollTransaction.tx_date >= start, PayrollTransaction.tx_date <= end)
    )
    breakdown: dict[str, Decimal] = {}
    for key, reason, amount in reasons:
        label = "Опоздание" if key and ":late:" in key else "Ранний уход" if key and ":early:" in key else "Отсутствие" if key and ":absent:" in key else (reason.split(":")[0][:30] if reason else "Другое")
        breakdown[label] = breakdown.get(label, Decimal(0)) + Decimal(str(amount))
    return {"date_from": start.isoformat(), "date_to": end.isoformat(), "by_type": out, "series": list(series.values()),
            "fine_breakdown": [{"label": k, "sum": v} for k, v in sorted(breakdown.items(), key=lambda x: -x[1])]}


@router.get("/transactions")
async def list_transactions(p: Auth, db: DB, year: int | None = None, month: int | None = None, date_from: date | None = None,
                            date_to: date | None = None, tx_type: str | None = None, employee_id: int | None = None,
                            include_deleted: bool = False, page: int = 1, per_page: int = Query(default=100, le=1000)):
    _require_finance(p)
    start, end = _period(year, month, date_from, date_to)
    q = select(PayrollTransaction, Employee).join(Employee, Employee.id == PayrollTransaction.employee_id).where(
        PayrollTransaction.project_id == p.project.id, PayrollTransaction.tx_date >= start, PayrollTransaction.tx_date <= end)
    if not include_deleted:
        q = q.where(PayrollTransaction.deleted_at.is_(None))
    if tx_type:
        q = q.where(PayrollTransaction.type == TxType(tx_type))
    if employee_id:
        q = q.where(PayrollTransaction.employee_id == employee_id)
    if p.branch_id:
        q = q.where(Employee.branch_id == p.branch_id)
    total = (await db.execute(select(func.count()).select_from(q.subquery()))).scalar_one()
    rows = (await db.execute(q.order_by(PayrollTransaction.created_at.desc()).offset((page - 1) * per_page).limit(per_page))).unique().all()
    # running balance per employee (for the period) — computed from oldest to newest
    balances: dict[int, Decimal] = {}
    ordered = sorted(rows, key=lambda r: r[0].created_at)
    bal_by_tx: dict[int, Decimal] = {}
    for t, _ in ordered:
        balances[t.employee_id] = balances.get(t.employee_id, Decimal(0)) + Decimal(str(t.amount)) * TX_SIGN[t.type.value]
        bal_by_tx[t.id] = balances[t.employee_id]
    return {"items": [tx_out(t, e, bal_by_tx.get(t.id)) for t, e in rows], "total": total, "page": page, "per_page": per_page}


@router.post("/transactions", response_model=TransactionOut, status_code=201)
async def create_transaction(data: TransactionIn, p: AdminOnly, db: DB, request: Request):
    _require_finance(p)
    emp = await get_employee_or_404(db, p.project.id, data.employee_id)
    svc = PayrollService(db, p.project)
    tx = await svc.add_transaction(emp, TxType(data.type), data.amount, data.tx_date or date.today(), reason=data.reason,
                                   comment=data.comment, created_by=p.username)
    await log_action(db, project_id=p.project.id, actor=p.username, category="finance", action=data.type,
                     details=f"{TX_LABEL[data.type]}: {emp.full_name} — {data.reason or '—'}", entity_type="employee", entity_id=emp.id,
                     amount=float(data.amount) * TX_SIGN[data.type], request=request)
    await db.commit()
    return tx_out(tx, emp)


@router.patch("/transactions/{tx_id}", response_model=TransactionOut)
async def update_transaction(tx_id: int, data: TransactionUpdateIn, p: AdminOnly, db: DB, request: Request):
    tx = await db.get(PayrollTransaction, tx_id)
    if not tx or tx.project_id != p.project.id:
        raise HTTPException(404)
    emp = await get_employee_or_404(db, p.project.id, tx.employee_id)
    if data.amount is not None:
        tx.amount = data.amount
    if data.reason is not None:
        tx.reason = data.reason
    if data.comment is not None:
        tx.comment = data.comment
    if data.tx_date is not None:
        tx.tx_date, tx.period_year, tx.period_month = data.tx_date, data.tx_date.year, data.tx_date.month
    if tx.auto_key and tx.auto_key.startswith("auto:"):
        tx.auto_key = f"manual:{tx.id}"  # detached from auto-sync once edited by hand
        tx.created_by = p.username
    await log_action(db, project_id=p.project.id, actor=p.username, category="finance", action="tx_update",
                     details=f"Изменена операция #{tx.id} ({TX_LABEL[tx.type.value]}) {emp.full_name}", entity_type="employee", entity_id=emp.id,
                     amount=float(tx.amount), request=request)
    await db.commit()
    return tx_out(tx, emp)


@router.delete("/transactions/{tx_id}", status_code=204)
async def delete_transaction(tx_id: int, p: AdminOnly, db: DB, request: Request):
    tx = await db.get(PayrollTransaction, tx_id)
    if not tx or tx.project_id != p.project.id:
        raise HTTPException(404)
    tx.deleted_at = datetime.now(timezone.utc)
    tx.deleted_by = p.username
    if tx.auto_key and tx.auto_key.startswith("auto:"):
        tx.auto_key = f"deleted:{tx.id}:{tx.auto_key}"  # allow re-creation if the fine is still due; prevents zombie
    await log_action(db, project_id=p.project.id, actor=p.username, category="finance", action="tx_delete",
                     details=f"Удалена операция #{tx.id} ({TX_LABEL[tx.type.value]})", amount=float(tx.amount), request=request)
    await db.commit()


@router.post("/transactions/{tx_id}/restore", response_model=TransactionOut)
async def restore_transaction(tx_id: int, p: AdminOnly, db: DB):
    tx = await db.get(PayrollTransaction, tx_id)
    if not tx or tx.project_id != p.project.id:
        raise HTTPException(404)
    tx.deleted_at, tx.deleted_by = None, None
    await db.commit()
    return tx_out(tx, await get_employee_or_404(db, p.project.id, tx.employee_id))


@router.post("/accrue-salary/{employee_id}")
async def accrue(employee_id: int, data: AccrueIn, p: AdminOnly, db: DB, request: Request):
    _require_finance(p)
    emp = await get_employee_or_404(db, p.project.id, employee_id)
    tx, summary = await PayrollService(db, p.project).accrue_salary(emp, data.year, data.month, p.username)
    await log_action(db, project_id=p.project.id, actor=p.username, category="finance", action="salary",
                     details=f"Начислена зарплата {emp.full_name} за {data.month:02d}.{data.year}: {tx.reason}",
                     entity_type="employee", entity_id=emp.id, amount=float(tx.amount), request=request)
    await db.commit()
    return {"ok": True, "transaction": tx_out(tx, emp), "amount": tx.amount,
            "worked_minutes": summary.worked_minutes, "scheduled_minutes": summary.scheduled_minutes}


@router.post("/accrue-salary")
async def accrue_all(data: AccrueIn, p: AdminOnly, db: DB, request: Request):
    _require_finance(p)
    employees = await active_employees(db, p)
    svc = PayrollService(db, p.project)
    out = []
    for emp in employees:
        if not emp.salary_rates:
            continue
        tx, _ = await svc.accrue_salary(emp, data.year, data.month, p.username)
        out.append({"employee_id": emp.id, "amount": tx.amount})
    await log_action(db, project_id=p.project.id, actor=p.username, category="finance", action="salary_all",
                     details=f"Массовое начисление за {data.month:02d}.{data.year}: {len(out)} сотр.", request=request)
    await db.commit()
    return {"count": len(out), "items": out}


@router.get("/employee/{employee_id}")
async def employee_finance(employee_id: int, p: Auth, db: DB, year: int | None = None, month: int | None = None,
                           date_from: date | None = None, date_to: date | None = None):
    _require_finance(p)
    emp = await get_employee_or_404(db, p.project.id, employee_id)
    start, end = _period(year, month, date_from, date_to)
    s = await PayrollService(db, p.project).earned(emp, start, end)
    await db.commit()
    return {"employee_id": emp.id, "date_from": start.isoformat(), "date_to": end.isoformat(), "rate_type": s.rate_type,
            "rate_amount": s.rate_amount, "units": s.units, "worked_minutes": s.worked_minutes, "scheduled_minutes": s.scheduled_minutes,
            "overtime_minutes": s.overtime_minutes, "scheduled_days": s.scheduled_days, "worked_days": s.worked_days,
            "late_count": s.late_count, "early_count": s.early_count, "absent_count": s.absent_count, "excused_count": s.excused_count,
            "earned": s.earned, "overtime_pay": s.overtime_pay, "bonuses": s.bonuses, "fines": s.fines, "accrued": s.accrued,
            "paid": s.paid, "total": s.total, "to_pay": s.to_pay, "days": s.days}


@router.get("/employee/{employee_id}/history")
async def employee_history(employee_id: int, p: Auth, db: DB, limit: int = 200):
    """Unified timeline: payroll transactions + audit log entries for the employee."""
    from app.models import AuditLog

    emp = await get_employee_or_404(db, p.project.id, employee_id)
    txs = (await db.execute(select(PayrollTransaction).where(PayrollTransaction.employee_id == emp.id).order_by(PayrollTransaction.created_at.desc()).limit(limit))).scalars().all()
    logs = (await db.execute(select(AuditLog).where(AuditLog.project_id == p.project.id, AuditLog.entity_type == "employee", AuditLog.entity_id == emp.id,
                                                    AuditLog.category.in_(["attendance", "employees"])).order_by(AuditLog.created_at.desc()).limit(limit))).scalars().all()
    items = [{"id": f"tx-{t.id}", "kind": "payroll", "action": t.type.value, "summary": TX_LABEL[t.type.value] + (f" · {t.reason}" if t.reason else ""),
              "description": t.comment, "amount": Decimal(str(t.amount)) * TX_SIGN[t.type.value], "actor": t.created_by, "created_at": t.created_at,
              "deleted_at": t.deleted_at, "tx_id": t.id, "is_auto": bool(t.auto_key and t.auto_key.startswith("auto:"))} for t in txs]
    items += [{"id": f"log-{l.id}", "kind": "log", "action": l.action, "summary": l.details, "description": None, "amount": None,
               "actor": l.actor, "created_at": l.created_at, "deleted_at": None} for l in logs]
    items.sort(key=lambda x: x["created_at"], reverse=True)
    return items[:limit]
