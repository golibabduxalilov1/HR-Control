from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Header, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decode_token
from app.db.session import get_db
from app.models import CabinetUser, License, PlatformUser, Project, UserRole

bearer = HTTPBearer(auto_error=False)

DB = Annotated[AsyncSession, Depends(get_db)]


@dataclass
class Principal:
    """Authenticated cabinet user bound to a tenant."""

    user: CabinetUser
    project: Project
    role: UserRole

    @property
    def username(self) -> str:
        return self.user.username

    @property
    def branch_id(self) -> int | None:
        return self.user.branch_id

    @property
    def is_hq(self) -> bool:
        return self.user.branch_id is None

    def can(self, *roles: UserRole) -> bool:
        return self.role in roles


async def resolve_project(
    db: AsyncSession, slug: str | None
) -> Project | None:
    if not slug:
        return None
    result = await db.execute(select(Project).where(Project.slug == slug.lower()))
    return result.scalar_one_or_none()


async def get_project_slug(
    x_project_slug: Annotated[str | None, Header(alias="X-WP-Project-Slug")] = None,
) -> str | None:
    return x_project_slug


async def get_current_principal(
    request: Request,
    db: DB,
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)] = None,
) -> Principal:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    payload = decode_token(creds.credentials)
    if not payload or payload.get("kind") != "cabinet":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")
    user = await db.get(CabinetUser, int(payload["uid"]))
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User disabled")
    project = await db.get(Project, user.project_id)
    if project is None or not project.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Project disabled")
    lic = (await db.execute(select(License).where(License.project_id == project.id))).scalar_one_or_none()
    if lic and lic.access_blocked:
        raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED, lic.block_reason or "Access blocked")
    request.state.principal_name = user.username
    request.state.project_id = project.id
    return Principal(user=user, project=project, role=user.role)


Auth = Annotated[Principal, Depends(get_current_principal)]


def require_roles(*roles: UserRole):
    async def _dep(principal: Auth) -> Principal:
        if principal.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient permissions")
        return principal

    return _dep


AdminOnly = Annotated[Principal, Depends(require_roles(UserRole.admin))]
AdminOrHr = Annotated[Principal, Depends(require_roles(UserRole.admin, UserRole.hr))]


async def get_platform_admin(
    db: DB,
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)] = None,
) -> PlatformUser:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    payload = decode_token(creds.credentials)
    if not payload or payload.get("kind") != "platform":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")
    user = await db.get(PlatformUser, int(payload["uid"]))
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User disabled")
    return user


PlatformAuth = Annotated[PlatformUser, Depends(get_platform_admin)]
