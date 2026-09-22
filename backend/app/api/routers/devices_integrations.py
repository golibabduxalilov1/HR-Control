from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import func, select

from app.core.deps import DB, AdminOnly, Auth
from app.core.project_settings import merged_settings
from app.models import ApiKey, Device, License
from app.schemas import ApiKeyCreated, ApiKeyOut, DeviceIn, DeviceOut
from app.services.audit import log_action

router = APIRouter(tags=["integrations"])


# ------------------------------------------------------------------ devices


@router.get("/devices", response_model=list[DeviceOut])
async def list_devices(p: Auth, db: DB):
    rows = (await db.execute(select(Device).where(Device.project_id == p.project.id).order_by(Device.id))).scalars().all()
    return [DeviceOut.model_validate(d) for d in rows]


@router.post("/devices", response_model=DeviceOut, status_code=201)
async def create_device(data: DeviceIn, p: AdminOnly, db: DB, request: Request):
    lic = (await db.execute(select(License).where(License.project_id == p.project.id))).scalar_one_or_none()
    count = (await db.execute(select(func.count(Device.id)).where(Device.project_id == p.project.id))).scalar_one()
    if lic and lic.max_devices and count >= lic.max_devices:
        raise HTTPException(402, f"Лимит устройств по лицензии: {lic.max_devices}")
    d = Device(project_id=p.project.id, **data.model_dump())
    db.add(d)
    await log_action(db, project_id=p.project.id, actor=p.username, category="devices", action="device_create", details=f"Добавлено устройство «{d.name}»", request=request)
    await db.commit()
    return DeviceOut.model_validate(d)


@router.put("/devices/{did}", response_model=DeviceOut)
async def update_device(did: int, data: DeviceIn, p: AdminOnly, db: DB):
    d = await db.get(Device, did)
    if not d or d.project_id != p.project.id:
        raise HTTPException(404)
    for k, v in data.model_dump().items():
        if k == "password" and not v:
            continue
        setattr(d, k, v)
    await db.commit()
    return DeviceOut.model_validate(d)


@router.delete("/devices/{did}", status_code=204)
async def delete_device(did: int, p: AdminOnly, db: DB):
    d = await db.get(Device, did)
    if not d or d.project_id != p.project.id:
        raise HTTPException(404)
    await db.delete(d)
    await db.commit()


@router.get("/devices/live-status")
async def devices_live(p: Auth, db: DB):
    rows = (await db.execute(select(Device).where(Device.project_id == p.project.id))).scalars().all()
    now = datetime.now(timezone.utc)
    return [{"id": d.id, "name": d.name, "is_online": bool(d.last_seen_at and (now - d.last_seen_at).total_seconds() < 300), "last_seen_at": d.last_seen_at} for d in rows]


# ------------------------------------------------------------------ api keys


def hash_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


@router.get("/integrations/api-keys", response_model=list[ApiKeyOut])
async def list_keys(p: AdminOnly, db: DB):
    rows = (await db.execute(select(ApiKey).where(ApiKey.project_id == p.project.id).order_by(ApiKey.id))).scalars().all()
    return [ApiKeyOut.model_validate(k) for k in rows]


@router.post("/integrations/api-keys", response_model=ApiKeyCreated, status_code=201)
async def create_key(data: dict, p: AdminOnly, db: DB, request: Request):
    name = (data.get("name") or "key").strip()
    raw = f"wpik_{p.project.slug}_{secrets.token_urlsafe(24)}"
    k = ApiKey(project_id=p.project.id, name=name, prefix=raw[:18] + "…", key_hash=hash_key(raw))
    db.add(k)
    await log_action(db, project_id=p.project.id, actor=p.username, category="integrations", action="api_key_create", details=f"Создан API-ключ «{name}»", request=request)
    await db.commit()
    return ApiKeyCreated(id=k.id, name=k.name, prefix=k.prefix, created_at=k.created_at, last_used_at=None, revoked_at=None, key=raw)


@router.delete("/integrations/api-keys/{kid}", status_code=204)
async def revoke_key(kid: int, p: AdminOnly, db: DB, request: Request):
    k = await db.get(ApiKey, kid)
    if not k or k.project_id != p.project.id:
        raise HTTPException(404)
    k.revoked_at = datetime.now(timezone.utc)
    await log_action(db, project_id=p.project.id, actor=p.username, category="integrations", action="api_key_revoke", details=f"Отозван API-ключ «{k.name}»", request=request)
    await db.commit()


# ------------------------------------------------------------------ hikcentral


@router.post("/integrations/hikcentral/test")
async def hik_test(p: AdminOnly, db: DB):
    from app.integrations.hikcentral import HikCentralClient

    s = merged_settings(p.project.settings)
    if not s.get("hik_base_url") or not s.get("hik_app_key"):
        raise HTTPException(400, "Укажите URL, AppKey и AppSecret HikCentral")
    client = HikCentralClient(s["hik_base_url"], s["hik_app_key"], s.get("hik_app_secret", ""), verify_ssl=bool(s.get("hik_verify_ssl")))
    try:
        info = await client.test_connection()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"HikCentral недоступен: {exc}")
    return {"ok": True, **info}


@router.post("/integrations/hikcentral/sync-now")
async def hik_sync_now(p: AdminOnly, db: DB):
    from app.integrations.hikcentral import sync_project_events

    result = await sync_project_events(db, p.project)
    await db.commit()
    return result


@router.post("/integrations/hikcentral/push-person/{employee_id}")
async def hik_push_person(employee_id: int, p: AdminOnly, db: DB):
    from app.api.routers.employees import get_employee_or_404
    from app.integrations.hikcentral import push_employee

    emp = await get_employee_or_404(db, p.project.id, employee_id)
    try:
        person_id = await push_employee(db, p.project, emp)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"Ошибка HikCentral: {exc}")
    await db.commit()
    return {"ok": True, "hik_person_id": person_id}


# ------------------------------------------------------------------ telegram


@router.post("/integrations/telegram/test")
async def telegram_test(data: dict, p: AdminOnly, db: DB):
    """Verify a bot token (kind: registration | attendance_feed | late_absent) and optionally send a test message."""
    from app.bots.manager import bot_manager

    s = merged_settings(p.project.settings)
    kind = data.get("kind", "registration")
    token_key = {"registration": "telegram_bot_token", "attendance_feed": "attendance_feed_bot_token", "late_absent": "late_absent_bot_token"}[kind]
    token = data.get("token") or s.get(token_key)
    if not token:
        raise HTTPException(400, "Токен не задан")
    try:
        info = await bot_manager.get_me(token)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"Telegram: {exc}")
    sent = 0
    chat_ids = data.get("chat_ids") or []
    for chat_id in chat_ids:
        try:
            await bot_manager.send(token, chat_id, f"✅ <b>{p.project.name}</b>\n🔗 Подключение к боту успешно!\n🤖 @{info['username']}")
            sent += 1
        except Exception:  # noqa: BLE001
            pass
    return {"ok": True, "username": info["username"], "sent": sent}


@router.post("/integrations/telegram/restart")
async def telegram_restart(p: AdminOnly, db: DB):
    from app.bots.manager import bot_manager

    await bot_manager.reload_project(p.project.id)
    return {"ok": True}


@router.get("/integrations/telegram/bots")
async def telegram_bots(p: AdminOnly, db: DB):
    from app.bots.manager import bot_manager

    s = merged_settings(p.project.settings)
    out = {}
    for kind, key in (("registration", "telegram_bot_token"), ("attendance_feed", "attendance_feed_bot_token"), ("late_absent", "late_absent_bot_token")):
        token = s.get(key)
        info = None
        if token:
            try:
                info = await bot_manager.get_me(token)
            except Exception as exc:  # noqa: BLE001
                info = {"error": str(exc)}
        out[kind] = {"configured": bool(token), "info": info, "running": bot_manager.is_running(p.project.id, kind)}
    return out
