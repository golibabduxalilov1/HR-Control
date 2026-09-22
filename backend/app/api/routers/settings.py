from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.orm.attributes import flag_modified

from app.core.deps import DB, AdminOnly, Auth
from app.core.project_settings import DEFAULT_SETTINGS, SECRET_KEYS, merged_settings, public_settings
from app.models import AuditLog, Branch, Device, Employee, EmployeeStatus, License
from app.schemas import AuditOut, LicenseOut, SettingsPatch
from app.services.audit import log_action

router = APIRouter(tags=["settings"])

ALLOWED_KEYS = set(DEFAULT_SETTINGS) | SECRET_KEYS | {
    "telegram_templates_ru", "telegram_templates_uz", "employment_statuses", "attendance_day_statuses",
}


@router.get("/settings")
async def get_settings_(p: Auth, db: DB):
    data = public_settings(p.project.settings)
    return {
        "company_name": p.project.name, "inn": p.project.inn, "address": p.project.address, "phone": p.project.phone,
        "email": p.project.email, "timezone": p.project.timezone, "language": p.project.language,
        "last_password_change": p.user.last_password_change, "settings": data,
    }


@router.put("/settings")
async def update_settings(patch: SettingsPatch, p: AdminOnly, db: DB, request: Request):
    body = patch.model_dump()
    for key in ("company_name", "inn", "address", "phone", "email", "timezone", "language"):
        if key in body and body[key] is not None:
            setattr(p.project, "name" if key == "company_name" else key, body.pop(key))
        else:
            body.pop(key, None)
    incoming = body.pop("settings", None) or body
    unknown = [k for k in incoming if k not in ALLOWED_KEYS]
    if unknown:
        raise HTTPException(400, f"Неизвестные настройки: {', '.join(unknown)}")
    current = dict(p.project.settings or {})
    changed = []
    for k, v in incoming.items():
        if k in SECRET_KEYS and v in ("", None):
            continue  # empty secret = keep existing
        if current.get(k) != v:
            changed.append(k)
        current[k] = v
    p.project.settings = current
    flag_modified(p.project, "settings")
    if changed:
        await log_action(db, project_id=p.project.id, actor=p.username, category="settings", action="settings_update",
                         details="Изменены настройки: " + ", ".join(changed), request=request)
    await db.commit()
    return await get_settings_(p, db)


@router.get("/settings/defaults")
async def settings_defaults():
    return DEFAULT_SETTINGS


@router.get("/employment-statuses")
async def employment_statuses(p: Auth):
    return merged_settings(p.project.settings)["employment_statuses"]


@router.get("/attendance-day-statuses")
async def day_statuses(p: Auth):
    return merged_settings(p.project.settings)["attendance_day_statuses"]


@router.get("/license", response_model=LicenseOut)
async def license_info(p: Auth, db: DB):
    lic = (await db.execute(select(License).where(License.project_id == p.project.id))).scalar_one_or_none()
    emp = (await db.execute(select(func.count(Employee.id)).where(Employee.project_id == p.project.id, Employee.deleted_at.is_(None), Employee.status != EmployeeStatus.dismissed))).scalar_one()
    dev = (await db.execute(select(func.count(Device.id)).where(Device.project_id == p.project.id))).scalar_one()
    br = (await db.execute(select(func.count(Branch.id)).where(Branch.project_id == p.project.id))).scalar_one()
    if lic is None:
        return LicenseOut(plan_name="—", billing_mode="test", is_test_mode=True, valid_until=None, days_remaining=None, max_employees=0,
                          max_devices=0, max_branches=0, employee_count=emp, device_count=dev, branch_count=br, access_blocked=False,
                          block_reason="", amount=0, amount_paid=0, modules={})
    days = (lic.valid_until - datetime.now(timezone.utc)).days if lic.valid_until else None
    return LicenseOut(plan_name=lic.plan_name, billing_mode=lic.billing_mode, is_test_mode=lic.billing_mode == "test", valid_until=lic.valid_until,
                      days_remaining=days, max_employees=lic.max_employees, max_devices=lic.max_devices, max_branches=lic.max_branches,
                      employee_count=emp, device_count=dev, branch_count=br, access_blocked=lic.access_blocked, block_reason=lic.block_reason,
                      amount=lic.amount, amount_paid=lic.amount_paid, modules=lic.modules or {})


@router.get("/activity")
async def activity(p: AdminOnly, db: DB, q: str | None = None, category: str | None = None, limit: int = 200, offset: int = 0):
    query = select(AuditLog).where(AuditLog.project_id == p.project.id)
    if category and category != "all":
        query = query.where(AuditLog.category == category)
    if q:
        like = f"%{q}%"
        query = query.where(AuditLog.details.ilike(like) | AuditLog.actor.ilike(like) | AuditLog.ip.ilike(like))
    total = (await db.execute(select(func.count()).select_from(query.subquery()))).scalar_one()
    rows = (await db.execute(query.order_by(AuditLog.created_at.desc()).offset(offset).limit(min(limit, 500)))).scalars().all()
    return {"total": total, "items": [AuditOut.model_validate(r) for r in rows]}
