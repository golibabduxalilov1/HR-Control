import csv
import io
import secrets
from datetime import date, datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, File, HTTPException, Query, Request, UploadFile, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import selectinload

from app.core.deps import DB, AdminOnly, AdminOrHr, Auth
from app.models import (
    Department,
    Employee,
    EmployeeStatus,
    License,
    PieceworkEntry,
    Position,
    RateType,
    SalaryRate,
    Schedule,
    ScheduleMode,
    WorkMode,
)
from app.schemas import EmployeeIn, EmployeeOut, EmployeeStats, Paginated, PieceworkIn, PieceworkOut, SalaryRateIn, SalaryRateOut
from app.services.audit import log_action
from app.services.files import delete_file, public_url, save_image

router = APIRouter(prefix="/employees", tags=["employees"])


def schedule_label(e: Employee) -> str | None:
    if e.schedule_mode == ScheduleMode.flexible or e.schedule is None:
        return "Гибкий · по факту"
    s = e.schedule
    if s.start_time and s.end_time:
        label = f"{s.start_time.strftime('%H:%M')}–{s.end_time.strftime('%H:%M')}"
    else:
        label = s.name
    if e.schedule_mode == ScheduleMode.two_shifts and e.night_schedule and e.night_schedule.start_time:
        label += f" / {e.night_schedule.start_time.strftime('%H:%M')}–{e.night_schedule.end_time.strftime('%H:%M')}"
    return label


def to_out(e: Employee) -> EmployeeOut:
    rates = [SalaryRateOut.model_validate(r) for r in e.salary_rates]
    today = date.today()
    current = next((r for r in rates if r.effective_from <= today), None)
    return EmployeeOut(
        id=e.id, full_name=e.full_name, phone=e.phone, employee_number=e.employee_number,
        department_id=e.department_id, department_name=e.department.name if e.department else None,
        position_id=e.position_id, position_name=e.position.name if e.position else None,
        branch_id=e.branch_id, schedule_id=e.schedule_id, schedule_name=e.schedule.name if e.schedule else None,
        schedule_label=schedule_label(e), night_schedule_id=e.night_schedule_id,
        schedule_mode=e.schedule_mode.value, work_mode=e.work_mode.value, status=e.status.value,
        hire_date=e.hire_date, dismiss_date=e.dismiss_date, birth_date=e.birth_date,
        telegram_chat_id=e.telegram_chat_id, telegram_username=e.telegram_username, hik_person_id=e.hik_person_id,
        avatar_url=public_url(e.avatar_path, int(e.updated_at.timestamp()) if e.updated_at else None),
        auto_fines_enabled=e.auto_fines_enabled, notes=e.notes, current_rate=current, salary_rates=rates, created_at=e.created_at,
        passport_series=e.passport_series or "", passport_number=e.passport_number or "", passport_issued_by=e.passport_issued_by or "",
        passport_issue_date=e.passport_issue_date, passport_expiry_date=e.passport_expiry_date, pinfl=e.pinfl or "", address=e.address or "",
    )


def base_query(project_id: int):
    return select(Employee).where(Employee.project_id == project_id, Employee.deleted_at.is_(None))


async def get_employee_or_404(db, project_id: int, employee_id: int) -> Employee:
    e = (await db.execute(base_query(project_id).where(Employee.id == employee_id))).scalar_one_or_none()
    if e is None:
        raise HTTPException(404, "Сотрудник не найден")
    return e


async def _license_check(db, project_id: int):
    lic = (await db.execute(select(License).where(License.project_id == project_id))).scalar_one_or_none()
    if not lic or not lic.max_employees:
        return
    count = (await db.execute(select(func.count(Employee.id)).where(
        Employee.project_id == project_id, Employee.deleted_at.is_(None), Employee.status != EmployeeStatus.dismissed))).scalar_one()
    if count >= lic.max_employees:
        raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED, f"Достигнут лимит сотрудников по лицензии ({lic.max_employees})")


async def _next_number(db, project_id: int) -> str:
    rows = (await db.execute(select(Employee.employee_number).where(Employee.project_id == project_id))).scalars().all()
    nums = [int(n) for n in rows if n and n.isdigit()]
    return str(max(nums + [1000]) + 1)


@router.get("/stats", response_model=EmployeeStats)
async def stats(p: Auth, db: DB):
    q = select(Employee.status, func.count(Employee.id)).where(Employee.project_id == p.project.id, Employee.deleted_at.is_(None))
    if p.branch_id:
        q = q.where(Employee.branch_id == p.branch_id)
    rows = dict((await db.execute(q.group_by(Employee.status))).all())
    active = rows.get(EmployeeStatus.active, 0)
    leave = rows.get(EmployeeStatus.leave, 0)
    dismissed = rows.get(EmployeeStatus.dismissed, 0)
    return EmployeeStats(total=active + leave + dismissed, active=active, on_leave=leave, dismissed=dismissed)


@router.get("", response_model=Paginated)
async def list_employees(
    p: Auth, db: DB,
    q: str | None = None, status_: str | None = Query(default=None, alias="status"),
    department_id: int | None = None, branch_id: int | None = None,
    page: int = 1, per_page: int = Query(default=50, le=500),
):
    query = base_query(p.project.id)
    if p.branch_id:
        query = query.where(Employee.branch_id == p.branch_id)
    elif branch_id:
        query = query.where(Employee.branch_id == branch_id)
    if status_ and status_ != "all":
        query = query.where(Employee.status == EmployeeStatus(status_))
    if department_id:
        query = query.where(Employee.department_id == department_id)
    if q:
        from app.db.session import ci_like

        query = query.outerjoin(Position, Position.id == Employee.position_id).where(
            or_(ci_like(Employee.full_name, q), ci_like(Employee.phone, q), ci_like(Employee.employee_number, q), ci_like(Position.name, q))
        )
    total = (await db.execute(select(func.count()).select_from(query.subquery()))).scalar_one()
    rows = (await db.execute(query.order_by(Employee.full_name).offset((page - 1) * per_page).limit(per_page))).scalars().unique().all()
    return Paginated(items=[to_out(e) for e in rows], total=total, page=page, per_page=per_page)


@router.get("/{employee_id}", response_model=EmployeeOut)
async def get_employee(employee_id: int, p: Auth, db: DB):
    return to_out(await get_employee_or_404(db, p.project.id, employee_id))


async def _apply(e: Employee, data: EmployeeIn, db, project_id: int):
    for f in ("full_name", "phone", "department_id", "position_id", "branch_id", "schedule_id", "night_schedule_id",
              "hire_date", "dismiss_date", "birth_date", "auto_fines_enabled", "notes", "hik_person_id",
              "passport_series", "passport_number", "passport_issued_by", "passport_issue_date", "passport_expiry_date", "pinfl", "address"):
        setattr(e, f, getattr(data, f))
    e.full_name = e.full_name.strip()
    e.telegram_chat_id = (data.telegram_chat_id or None)
    e.schedule_mode = ScheduleMode(data.schedule_mode)
    e.work_mode = WorkMode(data.work_mode)
    e.status = EmployeeStatus(data.status)
    if e.status == EmployeeStatus.dismissed and not e.dismiss_date:
        e.dismiss_date = date.today()
    if e.schedule_mode == ScheduleMode.flexible:
        e.schedule_id = None
    if e.position_id:
        pos = await db.get(Position, e.position_id)
        if pos and pos.department_id and not e.department_id:
            e.department_id = pos.department_id


@router.post("", response_model=EmployeeOut, status_code=201)
async def create_employee(data: EmployeeIn, p: AdminOrHr, db: DB, request: Request):
    await _license_check(db, p.project.id)
    number = (data.employee_number or "").strip() or await _next_number(db, p.project.id)
    dup = (await db.execute(select(Employee).where(Employee.project_id == p.project.id, Employee.employee_number == number))).scalar_one_or_none()
    if dup:
        raise HTTPException(409, f"Табельный номер {number} уже используется")
    e = Employee(project_id=p.project.id, employee_number=number, full_name=data.full_name)
    await _apply(e, data, db, p.project.id)
    if data.salary_rate:
        e.salary_rates.append(SalaryRate(rate_type=RateType(data.salary_rate.rate_type), amount=data.salary_rate.amount, effective_from=data.salary_rate.effective_from))
    db.add(e)
    await db.flush()
    await log_action(db, project_id=p.project.id, actor=p.username, category="employees", action="employee_create",
                     details=f"Добавлен сотрудник {e.full_name}", entity_type="employee", entity_id=e.id, request=request)
    await db.commit()
    await db.refresh(e)
    return to_out(await get_employee_or_404(db, p.project.id, e.id))


@router.put("/{employee_id}", response_model=EmployeeOut)
async def update_employee(employee_id: int, data: EmployeeIn, p: AdminOrHr, db: DB, request: Request):
    e = await get_employee_or_404(db, p.project.id, employee_id)
    if data.employee_number and data.employee_number.strip() != e.employee_number:
        dup = (await db.execute(select(Employee).where(Employee.project_id == p.project.id, Employee.employee_number == data.employee_number.strip(), Employee.id != e.id))).scalar_one_or_none()
        if dup:
            raise HTTPException(409, "Табельный номер уже используется")
        e.employee_number = data.employee_number.strip()
    await _apply(e, data, db, p.project.id)
    await log_action(db, project_id=p.project.id, actor=p.username, category="employees", action="employee_update",
                     details=f"Обновлён сотрудник {e.full_name}", entity_type="employee", entity_id=e.id, request=request)
    await db.commit()
    await db.refresh(e, ["department", "position", "schedule", "night_schedule", "salary_rates"])
    return to_out(e)


@router.delete("/{employee_id}", status_code=204)
async def delete_employee(employee_id: int, p: AdminOnly, db: DB, request: Request):
    e = await get_employee_or_404(db, p.project.id, employee_id)
    e.deleted_at = datetime.now(timezone.utc)
    e.status = EmployeeStatus.dismissed
    await log_action(db, project_id=p.project.id, actor=p.username, category="employees", action="employee_delete",
                     details=f"Удалён сотрудник {e.full_name}", entity_type="employee", entity_id=e.id, request=request)
    await db.commit()


# ------------------------------------------------------------------ salary rates


@router.get("/{employee_id}/salary-rates", response_model=list[SalaryRateOut])
async def list_rates(employee_id: int, p: Auth, db: DB):
    e = await get_employee_or_404(db, p.project.id, employee_id)
    return [SalaryRateOut.model_validate(r) for r in e.salary_rates]


@router.post("/{employee_id}/salary-rates", response_model=SalaryRateOut, status_code=201)
async def add_rate(employee_id: int, data: SalaryRateIn, p: AdminOnly, db: DB, request: Request):
    e = await get_employee_or_404(db, p.project.id, employee_id)
    r = SalaryRate(employee_id=e.id, rate_type=RateType(data.rate_type), amount=data.amount, effective_from=data.effective_from)
    db.add(r)
    unit = {"hourly": "сум/ч", "piece": "сум/ед."}.get(data.rate_type, "сум")
    kind = {"hourly": "Ставка", "piece": "Сдельная ставка"}.get(data.rate_type, "Оклад")
    await log_action(db, project_id=p.project.id, actor=p.username, category="employees", action="salary_rate",
                     details=f"{kind} {e.full_name}: {data.amount:,.0f} {unit} с {data.effective_from:%d.%m.%Y}".replace(",", " "),
                     entity_type="employee", entity_id=e.id, amount=float(data.amount), request=request)
    await db.commit()
    await db.refresh(r)
    return SalaryRateOut.model_validate(r)


@router.delete("/{employee_id}/salary-rates/{rate_id}", status_code=204)
async def delete_rate(employee_id: int, rate_id: int, p: AdminOnly, db: DB):
    r = await db.get(SalaryRate, rate_id)
    if not r or r.employee_id != employee_id:
        raise HTTPException(404)
    await db.delete(r)
    await db.commit()


# ------------------------------------------------------------------ piecework (сдельная выработка)


@router.get("/{employee_id}/piecework")
async def list_piecework(employee_id: int, p: Auth, db: DB, date_from: date = Query(...), date_to: date = Query(...)):
    e = await get_employee_or_404(db, p.project.id, employee_id)
    rows = (await db.execute(
        select(PieceworkEntry).where(PieceworkEntry.employee_id == e.id, PieceworkEntry.work_date >= date_from, PieceworkEntry.work_date <= date_to)
        .order_by(PieceworkEntry.work_date.desc(), PieceworkEntry.id.desc())
    )).scalars().all()
    items = [PieceworkOut.model_validate(r) for r in rows]
    return {"items": items, "total_quantity": sum((x.quantity for x in items), Decimal(0))}


@router.post("/{employee_id}/piecework", response_model=PieceworkOut, status_code=201)
async def add_piecework(employee_id: int, data: PieceworkIn, p: AdminOrHr, db: DB, request: Request):
    e = await get_employee_or_404(db, p.project.id, employee_id)
    r = PieceworkEntry(employee_id=e.id, work_date=data.work_date, quantity=data.quantity, note=data.note.strip())
    db.add(r)
    await log_action(db, project_id=p.project.id, actor=p.username, category="employees", action="piecework",
                     details=f"Выработка {e.full_name}: {data.quantity:g} ед. за {data.work_date:%d.%m.%Y}" + (f" — {data.note.strip()}" if data.note.strip() else ""),
                     entity_type="employee", entity_id=e.id, request=request)
    await db.commit()
    await db.refresh(r)
    return PieceworkOut.model_validate(r)


@router.delete("/{employee_id}/piecework/{entry_id}", status_code=204)
async def delete_piecework(employee_id: int, entry_id: int, p: AdminOrHr, db: DB):
    r = await db.get(PieceworkEntry, entry_id)
    if not r or r.employee_id != employee_id:
        raise HTTPException(404, "Запись не найдена")
    await get_employee_or_404(db, p.project.id, employee_id)
    await db.delete(r)
    await db.commit()


# ------------------------------------------------------------------ avatar


@router.post("/{employee_id}/avatar", response_model=EmployeeOut)
async def upload_avatar(employee_id: int, p: AdminOrHr, db: DB, request: Request, file: UploadFile = File(...)):
    e = await get_employee_or_404(db, p.project.id, employee_id)
    old = e.avatar_path
    e.avatar_path = await save_image(file, p.project.slug, "avatars", str(e.id))
    delete_file(old)
    await log_action(db, project_id=p.project.id, actor=p.username, category="employees", action="avatar_update",
                     details=f"Обновлено фото сотрудника {e.full_name}", entity_type="employee", entity_id=e.id, request=request)
    await db.commit()
    await db.refresh(e, ["department", "position", "schedule", "night_schedule", "salary_rates"])
    return to_out(e)


@router.delete("/{employee_id}/avatar", status_code=204)
async def delete_avatar(employee_id: int, p: AdminOrHr, db: DB):
    e = await get_employee_or_404(db, p.project.id, employee_id)
    delete_file(e.avatar_path)
    e.avatar_path = None
    await db.commit()


# ------------------------------------------------------------------ import / export


@router.post("/import")
async def import_employees(p: AdminOnly, db: DB, request: Request, file: UploadFile = File(...)):
    """CSV/TSV import: full_name, phone, employee_number, department, position, salary."""
    raw = (await file.read()).decode("utf-8-sig", errors="replace")
    dialect = csv.Sniffer().sniff(raw[:2048], delimiters=";,\t") if raw.strip() else csv.excel
    reader = csv.DictReader(io.StringIO(raw), dialect=dialect)
    departments = {d.name.lower(): d for d in (await db.execute(select(Department).where(Department.project_id == p.project.id))).scalars()}
    positions = {pos.name.lower(): pos for pos in (await db.execute(select(Position).where(Position.project_id == p.project.id))).scalars()}
    created, skipped, errors = 0, 0, []
    for i, row in enumerate(reader, start=2):
        name = (row.get("full_name") or row.get("ФИО") or row.get("name") or "").strip()
        if not name:
            skipped += 1
            continue
        try:
            await _license_check(db, p.project.id)
        except HTTPException as exc:
            errors.append(f"Строка {i}: {exc.detail}")
            break
        number = (row.get("employee_number") or row.get("Таб. №") or "").strip() or await _next_number(db, p.project.id)
        dep_name = (row.get("department") or row.get("Подразделение") or "").strip().lower()
        pos_name = (row.get("position") or row.get("Должность") or "").strip().lower()
        dep = departments.get(dep_name)
        if dep_name and not dep:
            dep = Department(project_id=p.project.id, name=dep_name.capitalize())
            db.add(dep)
            await db.flush()
            departments[dep_name] = dep
        pos = positions.get(pos_name)
        if pos_name and not pos:
            pos = Position(project_id=p.project.id, name=pos_name.capitalize(), department_id=dep.id if dep else None)
            db.add(pos)
            await db.flush()
            positions[pos_name] = pos
        e = Employee(project_id=p.project.id, full_name=name, phone=(row.get("phone") or row.get("Телефон") or "").strip(),
                     employee_number=number, department_id=dep.id if dep else None, position_id=pos.id if pos else None,
                     schedule_mode=ScheduleMode.flexible, hire_date=date.today())
        passport = (row.get("passport") or row.get("Паспорт") or "").replace(" ", "").strip().upper()
        if passport:
            e.passport_series, e.passport_number = passport[:2], passport[2:]
        e.pinfl = (row.get("pinfl") or row.get("ПИНФЛ") or "").strip()
        e.address = (row.get("address") or row.get("Адрес") or "").strip()
        salary = (row.get("salary") or row.get("Оклад") or "").replace(" ", "").strip()
        if salary.isdigit():
            e.salary_rates.append(SalaryRate(rate_type=RateType.monthly, amount=int(salary), effective_from=date.today().replace(day=1)))
        db.add(e)
        await db.flush()
        created += 1
    await log_action(db, project_id=p.project.id, actor=p.username, category="employees", action="employee_import",
                     details=f"Импорт сотрудников: {created} создано, {skipped} пропущено", request=request)
    await db.commit()
    return {"created": created, "skipped": skipped, "errors": errors}


@router.get("/export/csv")
async def export_csv(p: Auth, db: DB):
    from fastapi.responses import StreamingResponse

    rows = (await db.execute(base_query(p.project.id).order_by(Employee.full_name))).scalars().unique().all()
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";")
    w.writerow(["full_name", "employee_number", "phone", "department", "position", "schedule", "status", "salary", "passport", "pinfl", "birth_date", "address"])
    for e in rows:
        rate = e.salary_rates[0] if e.salary_rates else None
        w.writerow([e.full_name, e.employee_number, e.phone, e.department.name if e.department else "", e.position.name if e.position else "",
                    schedule_label(e), e.status.value, f"{rate.amount:.0f}" if rate else "", f"{e.passport_series}{e.passport_number}".strip(),
                    e.pinfl or "", e.birth_date.isoformat() if e.birth_date else "", e.address or ""])
    buf.seek(0)
    return StreamingResponse(iter(["﻿" + buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=employees.csv"})
