from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select

from app.core.deps import DB, Auth, get_project_slug
from app.core.security import create_access_token, hash_password, verify_password
from app.models import Branch, CabinetUser, Project
from app.schemas import ChangePasswordIn, LoginIn, LoginOut
from app.services.audit import log_action

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=LoginOut)
async def login(data: LoginIn, request: Request, db: DB, slug_header: str | None = Depends(get_project_slug)):
    slug = (data.project_slug or slug_header or "").lower().strip()
    if not slug:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Project slug is required")
    project = (await db.execute(select(Project).where(Project.slug == slug))).scalar_one_or_none()
    if project is None or not project.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    user = (
        await db.execute(
            select(CabinetUser).where(CabinetUser.project_id == project.id, CabinetUser.username == data.username.strip())
        )
    ).scalar_one_or_none()
    if user is None or not user.is_active or not verify_password(data.password, user.password_hash):
        await log_action(db, project_id=project.id, actor=data.username, category="auth", action="login_failed",
                         details=f"Неудачный вход: {data.username}", request=request)
        await db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Неверный логин или пароль")

    token = create_access_token({"kind": "cabinet", "uid": user.id, "sub": user.username, "role": user.role.value, "prj": project.slug})
    branch_name = None
    if user.branch_id:
        branch = await db.get(Branch, user.branch_id)
        branch_name = branch.name if branch else None
    await log_action(db, project_id=project.id, actor=user.username, category="auth", action="login",
                     details=f"Вход в систему: {user.username}", request=request)
    await db.commit()
    return LoginOut(
        access_token=token, project_slug=project.slug, display_name=user.display_name or project.name,
        role=user.role.value, branch_id=user.branch_id, branch_name=branch_name, is_hq=user.branch_id is None,
    )


@router.get("/status")
async def auth_status(request: Request, db: DB):
    from app.core.deps import bearer, decode_token

    creds = await bearer(request)
    if creds is None:
        return {"authenticated": False}
    payload = decode_token(creds.credentials)
    if not payload:
        return {"authenticated": False}
    return {"authenticated": True, "role": payload.get("role"), "project_slug": payload.get("prj"), "username": payload.get("sub")}


@router.get("/me")
async def me(principal: Auth):
    return {
        "username": principal.username,
        "display_name": principal.user.display_name,
        "role": principal.role.value,
        "branch_id": principal.branch_id,
        "is_hq": principal.is_hq,
        "project_slug": principal.project.slug,
        "project_name": principal.project.name,
    }


@router.post("/change-password")
async def change_password(data: ChangePasswordIn, principal: Auth, db: DB, request: Request):
    if not verify_password(data.current_password, principal.user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Текущий пароль неверен")
    principal.user.password_hash = hash_password(data.new_password)
    principal.user.last_password_change = datetime.now(timezone.utc)
    await log_action(db, project_id=principal.project.id, actor=principal.username, category="auth",
                     action="password_change", details="Пароль изменён", request=request)
    await db.commit()
    return {"ok": True}
