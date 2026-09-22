"""Public endpoints (branding, license), uploads, and the read-only Integration API (v1)."""

from __future__ import annotations

from datetime import date, datetime, timezone
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy import select

from app.api.routers.devices_integrations import hash_key
from app.core.deps import DB, get_project_slug, resolve_project
from app.core.project_settings import merged_settings
from app.models import ApiKey, Employee, EmployeeStatus, License, Project
from app.services.files import upload_root
from app.services.payroll import PayrollService, month_bounds

router = APIRouter(tags=["public"])


@router.get("/public/branding")
async def branding(db: DB, slug: str | None = Depends(get_project_slug)):
    project = await resolve_project(db, slug)
    s = merged_settings(project.settings if project else None)
    return {"theme_mode": s["theme_mode"], "site_theme": s["site_theme"], "brand_color": s.get("brand_color") or None, "company_name": project.name if project else None,
            "language": project.language if project else "ru", "background_url": s.get("app_background_url")}


@router.get("/public/license")
async def public_license(db: DB, slug: str | None = Depends(get_project_slug)):
    project = await resolve_project(db, slug)
    if not project:
        return {"exists": False}
    lic = (await db.execute(select(License).where(License.project_id == project.id))).scalar_one_or_none()
    return {"exists": True, "access_blocked": bool(lic and lic.access_blocked), "block_reason": lic.block_reason if lic else "",
            "plan_name": lic.plan_name if lic else None, "is_test_mode": (lic.billing_mode == "test") if lic else True}


@router.get("/uploads/{path:path}")
async def serve_upload(path: str):
    root = upload_root()
    full = (root / path).resolve()
    if not str(full).startswith(str(root)) or not full.is_file():
        raise HTTPException(404)
    return FileResponse(full, headers={"Cache-Control": "public, max-age=86400"})


# ------------------------------------------------------------------ Integration API v1


async def api_key_project(db: DB, authorization: Annotated[str | None, Header()] = None) -> tuple[Project, ApiKey]:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Bearer API key required")
    raw = authorization.split(" ", 1)[1].strip()
    key = (await db.execute(select(ApiKey).where(ApiKey.key_hash == hash_key(raw), ApiKey.revoked_at.is_(None)))).scalar_one_or_none()
    if key is None:
        raise HTTPException(401, "Invalid API key")
    key.last_used_at = datetime.now(timezone.utc)
    project = await db.get(Project, key.project_id)
    await db.commit()
    return project, key


KeyAuth = Annotated[tuple[Project, ApiKey], Depends(api_key_project)]

v1 = APIRouter(prefix="/v1/integration", tags=["integration-api"])


@v1.get("/me")
async def v1_me(auth: KeyAuth):
    project, key = auth
    return {"project_slug": project.slug, "project_name": project.name, "key_name": key.name, "timezone": project.timezone}


@v1.get("/employees")
async def v1_employees(auth: KeyAuth, db: DB, status: str | None = None):
    project, _ = auth
    q = select(Employee).where(Employee.project_id == project.id, Employee.deleted_at.is_(None))
    if status:
        q = q.where(Employee.status == EmployeeStatus(status))
    rows = (await db.execute(q.order_by(Employee.full_name))).scalars().unique().all()
    return [{"id": e.id, "full_name": e.full_name, "employee_number": e.employee_number, "phone": e.phone, "status": e.status.value,
             "department": e.department.name if e.department else None, "position": e.position.name if e.position else None,
             "hire_date": e.hire_date} for e in rows]


@v1.get("/payroll/month")
async def v1_payroll_month(auth: KeyAuth, db: DB, year: int = Query(...), month: int = Query(...)):
    project, _ = auth
    start, end = month_bounds(year, month)
    rows = (await db.execute(select(Employee).where(Employee.project_id == project.id, Employee.deleted_at.is_(None)))).scalars().unique().all()
    svc = PayrollService(db, project)
    out = []
    for e in rows:
        s = await svc.earned(e, start, end, recompute=False)
        out.append({"employee_id": e.id, "full_name": e.full_name, "employee_number": e.employee_number, "worked_minutes": s.worked_minutes,
                    "scheduled_minutes": s.scheduled_minutes, "earned": s.earned, "bonuses": s.bonuses, "fines": s.fines, "paid": s.paid, "total": s.total})
    return {"year": year, "month": month, "items": out}


@v1.get("/employees/{employee_id}/payroll")
async def v1_employee_payroll(employee_id: int, auth: KeyAuth, db: DB, year: int = Query(...), month: int = Query(...)):
    project, _ = auth
    e = (await db.execute(select(Employee).where(Employee.project_id == project.id, Employee.id == employee_id))).scalar_one_or_none()
    if not e:
        raise HTTPException(404)
    start, end = month_bounds(year, month)
    s = await PayrollService(db, project).earned(e, start, end, recompute=False)
    return {"employee_id": e.id, "full_name": e.full_name, "year": year, "month": month, "worked_minutes": s.worked_minutes,
            "scheduled_minutes": s.scheduled_minutes, "earned": s.earned, "bonuses": s.bonuses, "fines": s.fines, "paid": s.paid, "total": s.total, "days": s.days}


@v1.post("/events")
async def v1_push_event(auth: KeyAuth, db: DB, data: dict):
    """Universal inbound webhook: {employee_number, event_time, direction, external_id?, device?}."""
    from app.integrations.ingest import ingest_event

    project, _ = auth
    result = await ingest_event(db, project, employee_number=str(data.get("employee_number", "")), event_time=data.get("event_time"),
                                direction=data.get("direction", "in"), external_id=data.get("external_id"), device_label=data.get("device", "API"), source="api")
    await db.commit()
    return result
