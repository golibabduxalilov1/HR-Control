"""Super-admin panel (/workplace): projects, licenses, announcements."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import func, select

from app.core.deps import DB, PlatformAuth
from app.core.security import create_access_token, hash_password, verify_password
from app.models import Announcement, CabinetUser, Employee, EmployeeStatus, License, PlatformUser, Project, UserRole
from app.schemas import LoginIn, ProjectIn, ProjectOut
from app.services.audit import log_action

router = APIRouter(prefix="/workplace", tags=["platform"])


@router.get("/status")
async def status_():
    return {"platform_enabled": True}


@router.post("/login")
async def platform_login(data: LoginIn, db: DB, request: Request):
    user = (await db.execute(select(PlatformUser).where(PlatformUser.username == data.username))).scalar_one_or_none()
    if not user or not user.is_active or not verify_password(data.password, user.password_hash):
        raise HTTPException(401, "Неверный логин или пароль")
    token = create_access_token({"kind": "platform", "uid": user.id, "sub": user.username})
    await log_action(db, project_id=None, actor=user.username, category="auth", action="platform_login", details="Вход в панель платформы", request=request)
    await db.commit()
    return {"access_token": token, "token_type": "bearer", "display_name": user.display_name or user.username}


async def project_out(db, p: Project) -> ProjectOut:
    emp = (await db.execute(select(func.count(Employee.id)).where(Employee.project_id == p.id, Employee.deleted_at.is_(None), Employee.status != EmployeeStatus.dismissed))).scalar_one()
    lic = (await db.execute(select(License).where(License.project_id == p.id))).scalar_one_or_none()
    return ProjectOut(id=p.id, slug=p.slug, name=p.name, timezone=p.timezone, language=p.language, is_active=p.is_active, created_at=p.created_at,
                      employee_count=emp, license=({"plan_name": lic.plan_name, "billing_mode": lic.billing_mode, "valid_until": lic.valid_until,
                                                     "max_employees": lic.max_employees, "max_devices": lic.max_devices, "max_branches": lic.max_branches,
                                                     "access_blocked": lic.access_blocked, "block_reason": lic.block_reason, "amount": lic.amount, "amount_paid": lic.amount_paid} if lic else None))


@router.get("/projects", response_model=list[ProjectOut])
async def list_projects(_: PlatformAuth, db: DB):
    rows = (await db.execute(select(Project).order_by(Project.id))).scalars().all()
    return [await project_out(db, p) for p in rows]


@router.post("/projects", response_model=ProjectOut, status_code=201)
async def create_project(data: ProjectIn, admin: PlatformAuth, db: DB, request: Request):
    exists = (await db.execute(select(Project).where(Project.slug == data.slug))).scalar_one_or_none()
    if exists:
        raise HTTPException(409, "Slug уже занят")
    p = Project(slug=data.slug, name=data.name, timezone=data.timezone, language=data.language, settings={})
    db.add(p)
    await db.flush()
    db.add(License(project_id=p.id, plan_name=data.plan_name, max_employees=data.max_employees, max_devices=data.max_devices,
                   max_branches=data.max_branches, valid_until=data.valid_until or datetime.now(timezone.utc) + timedelta(days=30)))
    db.add(CabinetUser(project_id=p.id, username=data.admin_username, password_hash=hash_password(data.admin_password), display_name="Admin", role=UserRole.admin))
    await log_action(db, project_id=p.id, actor=admin.username, category="platform", action="project_create", details=f"Создан проект {p.slug}", request=request)
    await db.commit()
    return await project_out(db, p)


@router.patch("/projects/{pid}", response_model=ProjectOut)
async def update_project(pid: int, data: dict, admin: PlatformAuth, db: DB):
    p = await db.get(Project, pid)
    if not p:
        raise HTTPException(404)
    for k in ("name", "timezone", "language", "is_active"):
        if k in data:
            setattr(p, k, data[k])
    lic = (await db.execute(select(License).where(License.project_id == p.id))).scalar_one_or_none()
    if lic is None:
        lic = License(project_id=p.id)
        db.add(lic)
    for k in ("plan_name", "billing_mode", "max_employees", "max_devices", "max_branches", "access_blocked", "block_reason", "amount", "amount_paid", "modules"):
        if k in data:
            setattr(lic, k, data[k])
    if "valid_until" in data:
        lic.valid_until = datetime.fromisoformat(data["valid_until"]) if data["valid_until"] else None
    if data.get("reset_admin_password"):
        u = (await db.execute(select(CabinetUser).where(CabinetUser.project_id == p.id, CabinetUser.role == UserRole.admin).order_by(CabinetUser.id))).scalars().first()
        if u:
            u.password_hash = hash_password(data["reset_admin_password"])
    await db.commit()
    return await project_out(db, p)


@router.get("/announcement")
async def get_announcement(db: DB):
    a = (await db.execute(select(Announcement).where(Announcement.is_active.is_(True)).order_by(Announcement.id.desc()))).scalars().first()
    return {"text": a.text, "level": a.level} if a else {"text": "", "level": "info"}


@router.put("/announcement")
async def set_announcement(data: dict, _: PlatformAuth, db: DB):
    a = Announcement(text=data.get("text", ""), level=data.get("level", "info"), is_active=bool(data.get("text")))
    for old in (await db.execute(select(Announcement).where(Announcement.is_active.is_(True)))).scalars():
        old.is_active = False
    db.add(a)
    await db.commit()
    return {"ok": True}
