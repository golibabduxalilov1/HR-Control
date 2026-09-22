from __future__ import annotations

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLog


def client_ip(request: Request | None) -> str:
    if request is None:
        return ""
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else ""


async def log_action(
    db: AsyncSession,
    *,
    project_id: int | None,
    actor: str,
    category: str,
    action: str,
    details: str = "",
    entity_type: str = "",
    entity_id: int | None = None,
    amount: float | None = None,
    request: Request | None = None,
) -> AuditLog:
    entry = AuditLog(
        project_id=project_id,
        actor=actor,
        ip=client_ip(request),
        user_agent=(request.headers.get("user-agent", "")[:255] if request else ""),
        category=category,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        details=details,
        amount=amount,
    )
    db.add(entry)
    return entry
