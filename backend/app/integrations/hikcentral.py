"""HikCentral Professional OpenAPI (Artemis) client + sync jobs.

Signing scheme: HMAC-SHA256 over the canonical string (method, accept, content-type,
x-ca-* headers, path) with the AppSecret; see HikCentral OpenAPI developer guide.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.core.project_settings import merged_settings
from app.models import Device, Employee, Project
from app.services.files import save_bytes, upload_root

EVENT_FACE_AUTH_PASSED = 197151  # access granted by face
EVENT_CARD_AUTH_PASSED = 197127
ACCESS_EVENT_TYPES = [EVENT_FACE_AUTH_PASSED, EVENT_CARD_AUTH_PASSED, 196893, 198914]


class HikCentralClient:
    def __init__(self, base_url: str, app_key: str, app_secret: str, verify_ssl: bool = False, timeout: float = 20.0):
        self.base_url = base_url.rstrip("/")
        self.app_key = app_key
        self.app_secret = app_secret
        self.verify_ssl = verify_ssl
        self.timeout = timeout

    def _headers(self, method: str, path: str, content_type: str = "application/json;charset=UTF-8") -> dict[str, str]:
        nonce = str(uuid.uuid4())
        ts = str(int(time.time() * 1000))
        accept = "*/*"
        sign_headers = ["x-ca-key", "x-ca-nonce", "x-ca-timestamp"]
        values = {"x-ca-key": self.app_key, "x-ca-nonce": nonce, "x-ca-timestamp": ts}
        string_to_sign = "\n".join([method.upper(), accept, content_type] + [f"{h}:{values[h]}" for h in sign_headers] + [path])
        signature = base64.b64encode(hmac.new(self.app_secret.encode(), string_to_sign.encode(), hashlib.sha256).digest()).decode()
        return {"Accept": accept, "Content-Type": content_type, "x-ca-key": self.app_key, "x-ca-nonce": nonce, "x-ca-timestamp": ts,
                "x-ca-signature-headers": ",".join(sign_headers), "x-ca-signature": signature}

    async def post(self, path: str, body: dict | None = None) -> Any:
        async with httpx.AsyncClient(verify=self.verify_ssl, timeout=self.timeout) as client:
            r = await client.post(self.base_url + path, json=body or {}, headers=self._headers("POST", path))
            r.raise_for_status()
            data = r.json()
        if str(data.get("code")) != "0":
            raise RuntimeError(f"HikCentral error {data.get('code')}: {data.get('msg')}")
        return data.get("data")

    async def post_raw(self, path: str, body: dict | None = None) -> bytes:
        async with httpx.AsyncClient(verify=self.verify_ssl, timeout=self.timeout) as client:
            r = await client.post(self.base_url + path, json=body or {}, headers=self._headers("POST", path))
            r.raise_for_status()
            return r.content

    # -- API wrappers -------------------------------------------------------------------

    async def test_connection(self) -> dict:
        data = await self.post("/artemis/api/resource/v1/acsDevice/acsDeviceList", {"pageNo": 1, "pageSize": 5})
        devices = (data or {}).get("list", [])
        return {"device_count": (data or {}).get("total", len(devices)), "devices": [{"id": d.get("acsDevIndexCode"), "name": d.get("acsDevName"), "status": d.get("status")} for d in devices]}

    async def list_devices(self) -> list[dict]:
        data = await self.post("/artemis/api/resource/v1/acsDevice/acsDeviceList", {"pageNo": 1, "pageSize": 500})
        return (data or {}).get("list", [])

    async def list_doors(self) -> list[dict]:
        data = await self.post("/artemis/api/resource/v1/acsDoor/acsDoorList", {"pageNo": 1, "pageSize": 500})
        return (data or {}).get("list", [])

    async def door_events(self, start: datetime, end: datetime, page: int = 1, page_size: int = 500, event_type: int | None = None) -> dict:
        body = {"startTime": start.isoformat(timespec="seconds"), "endTime": end.isoformat(timespec="seconds"), "pageNo": page, "pageSize": page_size}
        if event_type:
            body["eventType"] = event_type
        return await self.post("/artemis/api/acs/v1/door/events", body) or {}

    async def event_picture(self, pic_uri: str) -> bytes:
        return await self.post_raw("/artemis/api/acs/v1/event/pictures", {"picUri": pic_uri})

    async def find_person(self, person_code: str) -> dict | None:
        data = await self.post("/artemis/api/resource/v1/person/advance/personList", {"pageNo": 1, "pageSize": 1, "personCode": person_code})
        items = (data or {}).get("list", [])
        return items[0] if items else None

    async def add_person(self, person_code: str, name: str, org_index_code: str = "1", phone: str = "", face_b64: str | None = None) -> str:
        body = {"personCode": person_code, "personName": name, "orgIndexCode": org_index_code, "gender": 0, "phoneNo": phone}
        if face_b64:
            body["faces"] = [{"faceData": face_b64}]
        data = await self.post("/artemis/api/resource/v1/person/single/add", body)
        return str(data)

    async def update_person(self, person_id: str, name: str, phone: str = "") -> None:
        await self.post("/artemis/api/resource/v1/person/single/update", {"personId": person_id, "personName": name, "phoneNo": phone})

    async def add_face(self, person_id: str, face_b64: str) -> None:
        await self.post("/artemis/api/resource/v1/face/single/add", {"personId": person_id, "faceData": face_b64})

    async def delete_person(self, person_id: str) -> None:
        await self.post("/artemis/api/resource/v1/person/batch/delete", {"personIds": [person_id]})


def client_for(project: Project) -> HikCentralClient | None:
    s = merged_settings(project.settings)
    if not s.get("hik_enabled") or not s.get("hik_base_url") or not s.get("hik_app_key"):
        return None
    return HikCentralClient(s["hik_base_url"], s["hik_app_key"], s.get("hik_app_secret", ""), verify_ssl=bool(s.get("hik_verify_ssl")))


async def sync_project_events(db: AsyncSession, project: Project, lookback_minutes: int = 10) -> dict:
    """Pull new access events from HikCentral and ingest them as attendance events."""
    from app.integrations.ingest import ingest_event

    client = client_for(project)
    if client is None:
        return {"ok": False, "reason": "hik disabled"}
    tz = ZoneInfo(project.timezone or "Asia/Tashkent")
    s = merged_settings(project.settings)
    last = s.get("hik_last_event_time")
    start = datetime.fromisoformat(last) if last else datetime.now(tz) - timedelta(days=1)
    start = start.astimezone(tz) - timedelta(minutes=lookback_minutes)
    end = datetime.now(tz)

    devices = {d.hik_device_id: d for d in (await db.execute(select(Device).where(Device.project_id == project.id))).scalars() if d.hik_device_id}
    doors = {d.hik_door_index: d for d in devices.values() if d.hik_door_index}
    employees = {e.hik_person_id: e for e in (await db.execute(select(Employee).where(Employee.project_id == project.id, Employee.deleted_at.is_(None)))).scalars().unique() if e.hik_person_id}
    by_number = {e.employee_number: e for e in (await db.execute(select(Employee).where(Employee.project_id == project.id, Employee.deleted_at.is_(None)))).scalars().unique()}

    ingested, skipped, newest = 0, 0, start
    page = 1
    while True:
        data = await client.door_events(start, end, page=page)
        items = data.get("list", []) or []
        for ev in items:
            if ev.get("eventType") not in ACCESS_EVENT_TYPES and ev.get("eventType") is not None:
                continue
            person_id = str(ev.get("personId") or "")
            emp = employees.get(person_id) or by_number.get(str(ev.get("cardNo") or "")) or by_number.get(str(ev.get("personCode") or ""))
            if emp is None:
                skipped += 1
                continue
            device = devices.get(str(ev.get("devIndexCode") or "")) or doors.get(str(ev.get("doorIndexCode") or ""))
            in_out = ev.get("inAndOutType")
            if device and device.direction in ("in", "out"):
                direction = device.direction
            else:
                direction = "out" if str(in_out) == "2" else "in"
            when = ev.get("eventTime") or ev.get("happenTime")
            ev_dt = datetime.fromisoformat(when.replace("Z", "+00:00")) if isinstance(when, str) else when
            photo_path = None
            if ev.get("picUri"):
                try:
                    raw = await client.event_picture(ev["picUri"])
                    photo_path = save_bytes(raw, project.slug, "passes", f"{ev.get('eventId') or uuid.uuid4().hex}.jpg")
                except Exception:  # noqa: BLE001
                    photo_path = None
            res = await ingest_event(db, project, employee=emp, event_time=ev_dt, direction=direction, external_id=f"hik:{ev.get('eventId') or ev.get('eventIndexCode')}",
                                     device_label=ev.get("deviceName") or ev.get("doorName") or "HikCentral", device=device, source="terminal", photo_path=photo_path)
            if res.get("ok") and not res.get("duplicate"):
                ingested += 1
            if ev_dt and ev_dt > newest:
                newest = ev_dt
        if len(items) < 500:
            break
        page += 1

    settings = dict(project.settings or {})
    settings["hik_last_event_time"] = newest.isoformat()
    project.settings = settings
    flag_modified(project, "settings")
    return {"ok": True, "ingested": ingested, "skipped": skipped, "from": start.isoformat(), "to": end.isoformat()}


async def push_employee(db: AsyncSession, project: Project, employee: Employee) -> str:
    """Create/update the person in HikCentral and upload the avatar as the face template."""
    client = client_for(project)
    if client is None:
        raise RuntimeError("HikCentral не настроен")
    face_b64 = None
    if employee.avatar_path:
        face_b64 = base64.b64encode((upload_root() / employee.avatar_path).read_bytes()).decode()
    if employee.hik_person_id:
        await client.update_person(employee.hik_person_id, employee.full_name, employee.phone)
        if face_b64:
            await client.add_face(employee.hik_person_id, face_b64)
        return employee.hik_person_id
    existing = await client.find_person(employee.employee_number)
    if existing:
        person_id = str(existing.get("personId"))
        await client.update_person(person_id, employee.full_name, employee.phone)
        if face_b64:
            await client.add_face(person_id, face_b64)
    else:
        person_id = await client.add_person(employee.employee_number, employee.full_name, phone=employee.phone, face_b64=face_b64)
    employee.hik_person_id = person_id
    return person_id
