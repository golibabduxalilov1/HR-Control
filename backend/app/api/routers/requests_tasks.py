"""Absence/late requests (from Telegram or manual), bot subscribers, tasks."""

from __future__ import annotations

from datetime import date, datetime, time, timezone
from decimal import Decimal

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from sqlalchemy import func, select

from app.api.routers.employees import get_employee_or_404
from app.core.deps import DB, AdminOnly, AdminOrHr, Auth
from app.models import (
    AbsenceRequest,
    AttendanceDay,
    BotKind,
    BotSubscriber,
    DayStatus,
    Employee,
    RequestKind,
    RequestStatus,
    Task,
    TaskStatus,
    TxType,
)
from app.schemas import AbsenceRequestOut, DecisionIn, TaskIn, TaskOut
from app.services.audit import log_action
from app.services.files import public_url, save_image
from app.services.payroll import PayrollService
from app.services.timesheet import TimesheetService

router = APIRouter(tags=["requests"])


def req_out(r: AbsenceRequest, e: Employee) -> AbsenceRequestOut:
    return AbsenceRequestOut(
        id=r.id, employee_id=r.employee_id, employee_name=e.full_name, department_name=e.department.name if e.department else None,
        position_name=e.position.name if e.position else None, kind=r.kind.value, request_date=r.request_date, late_minutes=r.late_minutes,
        expected_time=r.expected_time, reason=r.reason, photo_url=public_url(r.photo_path), status=r.status.value, submitted_via=r.submitted_via,
        decided_by=r.decided_by, decided_at=r.decided_at, decision_comment=r.decision_comment, created_at=r.created_at,
    )


@router.get("/absence-requests/pending-count")
async def pending_count(p: Auth, db: DB):
    n = (await db.execute(select(func.count(AbsenceRequest.id)).where(AbsenceRequest.project_id == p.project.id, AbsenceRequest.status == RequestStatus.pending))).scalar_one()
    return {"count": n}


@router.get("/absence-requests")
async def list_requests(p: Auth, db: DB, status: str | None = None, limit: int = 200):
    q = select(AbsenceRequest, Employee).join(Employee, Employee.id == AbsenceRequest.employee_id).where(AbsenceRequest.project_id == p.project.id)
    if status and status != "all":
        q = q.where(AbsenceRequest.status == RequestStatus(status))
    rows = (await db.execute(q.order_by(AbsenceRequest.created_at.desc()).limit(limit))).unique().all()
    counts = dict((await db.execute(select(AbsenceRequest.status, func.count(AbsenceRequest.id)).where(AbsenceRequest.project_id == p.project.id).group_by(AbsenceRequest.status))).all())
    return {"items": [req_out(r, e) for r, e in rows],
            "counts": {"pending": counts.get(RequestStatus.pending, 0), "approved": counts.get(RequestStatus.approved, 0), "rejected": counts.get(RequestStatus.rejected, 0)}}


@router.post("/absence-requests", response_model=AbsenceRequestOut, status_code=201)
async def create_request(
    p: AdminOrHr, db: DB, request: Request,
    employee_id: int = Form(...), kind: str = Form("absent"), request_date: date = Form(...), reason: str = Form(""),
    late_minutes: int = Form(0), expected_time: str | None = Form(None), photo: UploadFile | None = File(None),
):
    emp = await get_employee_or_404(db, p.project.id, employee_id)
    r = AbsenceRequest(project_id=p.project.id, employee_id=emp.id, kind=RequestKind(kind), request_date=request_date, reason=reason,
                       late_minutes=late_minutes, expected_time=time.fromisoformat(expected_time) if expected_time else None, submitted_via=p.username)
    if photo:
        r.photo_path = await save_image(photo, p.project.slug, "requests", f"req-{emp.id}")
    db.add(r)
    await db.commit()
    return req_out(r, emp)


async def apply_decision(db, project, r: AbsenceRequest, emp: Employee, decision: str, actor: str, comment: str = "", apply_fine: bool | None = None):
    r.status = RequestStatus(decision)
    r.decided_by, r.decided_at, r.decision_comment = actor, datetime.now(timezone.utc), comment
    day = r.request_date
    row = (await db.execute(select(AttendanceDay).where(AttendanceDay.employee_id == emp.id, AttendanceDay.date == day))).scalar_one_or_none()
    if row is None:
        row = AttendanceDay(project_id=project.id, employee_id=emp.id, date=day)
        db.add(row)
    if r.status == RequestStatus.approved:
        # excused: no fines for this day (both absent and late kinds)
        row.is_manual, row.manual_status, row.comment, row.edited_by = True, DayStatus.excused, r.reason[:255], actor
    else:
        # rejected: return day to automatic computation → fines apply as usual
        if row.is_manual and row.manual_status == DayStatus.excused:
            row.is_manual, row.manual_status = False, None
        row.edited_by = actor
    ts = TimesheetService(db, project)
    res = await ts.recompute_employee(emp, day, day)
    await PayrollService(db, project).sync_auto_fines(emp, {day: res[day][0]}, datetime.now(ts.tz).date())


@router.post("/absence-requests/{rid}/decide", response_model=AbsenceRequestOut)
async def decide(rid: int, data: DecisionIn, p: AdminOrHr, db: DB, request: Request):
    r = await db.get(AbsenceRequest, rid)
    if not r or r.project_id != p.project.id:
        raise HTTPException(404)
    emp = await get_employee_or_404(db, p.project.id, r.employee_id)
    await apply_decision(db, p.project, r, emp, data.decision, p.username, data.comment, data.apply_fine)
    await log_action(db, project_id=p.project.id, actor=p.username, category="attendance", action="request_decision",
                     details=f"Заявка {emp.full_name} на {r.request_date:%d.%m.%Y}: {'принята' if data.decision == 'approved' else 'отклонена'}",
                     entity_type="employee", entity_id=emp.id, request=request)
    await db.commit()
    try:
        from app.bots.notify import notify_request_decision
        await notify_request_decision(db, p.project, r, emp)
    except Exception:  # noqa: BLE001 - notification failure must not break the decision
        pass
    return req_out(r, emp)


@router.delete("/absence-requests/{rid}", status_code=204)
async def delete_request(rid: int, p: AdminOnly, db: DB):
    r = await db.get(AbsenceRequest, rid)
    if not r or r.project_id != p.project.id:
        raise HTTPException(404)
    await db.delete(r)
    await db.commit()


# ------------------------------------------------------------------ bot subscribers


@router.get("/attendance-feed-subscribers/pending-count")
async def sub_pending(p: Auth, db: DB):
    n = (await db.execute(select(func.count(BotSubscriber.id)).where(BotSubscriber.project_id == p.project.id, BotSubscriber.status == RequestStatus.pending))).scalar_one()
    return {"count": n}


@router.get("/attendance-feed-subscribers")
async def list_subscribers(p: Auth, db: DB, status: str | None = None):
    q = select(BotSubscriber).where(BotSubscriber.project_id == p.project.id)
    if status and status != "all":
        q = q.where(BotSubscriber.status == RequestStatus(status))
    rows = (await db.execute(q.order_by(BotSubscriber.created_at.desc()))).scalars().all()
    counts = dict((await db.execute(select(BotSubscriber.status, func.count(BotSubscriber.id)).where(BotSubscriber.project_id == p.project.id).group_by(BotSubscriber.status))).all())
    return {"items": [{"id": s.id, "bot_kind": s.bot_kind.value, "chat_id": s.chat_id, "username": s.username, "full_name": s.full_name,
                       "status": s.status.value, "created_at": s.created_at} for s in rows],
            "counts": {k.value: counts.get(k, 0) for k in RequestStatus}}


@router.post("/attendance-feed-subscribers/{sid}/decide")
async def decide_subscriber(sid: int, data: DecisionIn, p: AdminOnly, db: DB):
    s = await db.get(BotSubscriber, sid)
    if not s or s.project_id != p.project.id:
        raise HTTPException(404)
    s.status = RequestStatus(data.decision)
    await db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ tasks


def task_out(t: Task, e: Employee) -> TaskOut:
    return TaskOut(id=t.id, employee_id=t.employee_id, employee_name=e.full_name, department_name=e.department.name if e.department else None,
                   position_name=e.position.name if e.position else None, title=t.title, description=t.description, bonus_amount=t.bonus_amount,
                   photo_url=public_url(t.photo_path), result_text=t.result_text, result_photo_url=public_url(t.result_photo_path), status=t.status.value,
                   created_by=t.created_by, created_at=t.created_at, accepted_at=t.accepted_at, completed_at=t.completed_at, reviewed_at=t.reviewed_at, reviewed_by=t.reviewed_by)


@router.get("/tasks")
async def list_tasks(p: Auth, db: DB, status: str | None = None, employee_id: int | None = None, limit: int = 200):
    q = select(Task, Employee).join(Employee, Employee.id == Task.employee_id).where(Task.project_id == p.project.id)
    if status and status != "all":
        q = q.where(Task.status == TaskStatus(status))
    if employee_id:
        q = q.where(Task.employee_id == employee_id)
    rows = (await db.execute(q.order_by(Task.created_at.desc()).limit(limit))).unique().all()
    counts = dict((await db.execute(select(Task.status, func.count(Task.id)).where(Task.project_id == p.project.id).group_by(Task.status))).all())
    return {"items": [task_out(t, e) for t, e in rows], "counts": {k.value: counts.get(k, 0) for k in TaskStatus}, "total": sum(counts.values())}


@router.post("/tasks", response_model=TaskOut, status_code=201)
async def create_task(p: AdminOrHr, db: DB, request: Request, employee_id: int = Form(...), title: str = Form(...),
                      description: str = Form(""), bonus_amount: Decimal = Form(Decimal(0)), photo: UploadFile | None = File(None)):
    emp = await get_employee_or_404(db, p.project.id, employee_id)
    t = Task(project_id=p.project.id, employee_id=emp.id, title=title.strip(), description=description, bonus_amount=bonus_amount, created_by=p.username)
    if photo:
        t.photo_path = await save_image(photo, p.project.slug, "tasks", f"task-{emp.id}")
    db.add(t)
    await db.flush()
    await log_action(db, project_id=p.project.id, actor=p.username, category="tasks", action="task", details=f"Задача: {emp.full_name} — {t.title}",
                     entity_type="employee", entity_id=emp.id, amount=float(bonus_amount) if bonus_amount else None, request=request)
    await db.commit()
    try:
        from app.bots.notify import notify_new_task
        await notify_new_task(db, p.project, t, emp)
    except Exception:  # noqa: BLE001
        pass
    return task_out(t, emp)


@router.post("/tasks/{tid}/review", response_model=TaskOut)
async def review_task(tid: int, data: DecisionIn, p: AdminOrHr, db: DB, request: Request):
    t = await db.get(Task, tid)
    if not t or t.project_id != p.project.id:
        raise HTTPException(404)
    emp = await get_employee_or_404(db, p.project.id, t.employee_id)
    t.status = TaskStatus.approved if data.decision == "approved" else TaskStatus.rejected
    t.reviewed_at, t.reviewed_by = datetime.now(timezone.utc), p.username
    if t.status == TaskStatus.approved and t.bonus_amount and not t.bonus_tx_id:
        tx = await PayrollService(db, p.project).add_transaction(emp, TxType.bonus, t.bonus_amount, date.today(), reason=f"Задача: {t.title}", created_by=p.username, meta={"task_id": t.id})
        t.bonus_tx_id = tx.id
    await log_action(db, project_id=p.project.id, actor=p.username, category="tasks", action="task_review",
                     details=f"Задача {'подтверждена' if t.status == TaskStatus.approved else 'отклонена'}: {emp.full_name} — {t.title}",
                     entity_type="employee", entity_id=emp.id, amount=float(t.bonus_amount) if t.status == TaskStatus.approved else None, request=request)
    await db.commit()
    try:
        from app.bots.notify import notify_task_review
        await notify_task_review(db, p.project, t, emp)
    except Exception:  # noqa: BLE001
        pass
    return task_out(t, emp)


@router.delete("/tasks/{tid}", status_code=204)
async def delete_task(tid: int, p: AdminOnly, db: DB):
    t = await db.get(Task, tid)
    if not t or t.project_id != p.project.id:
        raise HTTPException(404)
    await db.delete(t)
    await db.commit()
