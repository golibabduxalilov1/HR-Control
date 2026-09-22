"""SQLAlchemy models. All tenant-scoped tables carry project_id."""

from __future__ import annotations

import enum
from datetime import date, datetime, time

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    Time,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, TZDateTime, utcnow

# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------


class UserRole(str, enum.Enum):
    admin = "admin"
    operator = "operator"
    hr = "hr"
    manager = "manager"


class EmployeeStatus(str, enum.Enum):
    active = "active"
    leave = "leave"
    dismissed = "dismissed"


class WorkMode(str, enum.Enum):
    office = "office"
    remote = "remote"
    hybrid = "hybrid"


class ScheduleMode(str, enum.Enum):
    fixed = "fixed"  # one schedule
    two_shifts = "two_shifts"  # day / night (security)
    flexible = "flexible"  # no schedule, actual hours


class RateType(str, enum.Enum):
    monthly = "monthly"
    hourly = "hourly"
    piece = "piece"  # сдельная: сумма за единицу выработки


class ScheduleType(str, enum.Enum):
    fixed = "fixed"
    flexible = "flexible"
    shift = "shift"


class HoursCalc(str, enum.Enum):
    first_last = "first_last"
    sessions = "sessions"


class OvertimeMode(str, enum.Enum):
    none = "none"
    full_day = "full_day"  # whole day outside schedule at higher rate
    overtime_only = "overtime_only"  # only before/after shift


class EventDirection(str, enum.Enum):
    check_in = "in"
    check_out = "out"


class EventSource(str, enum.Enum):
    terminal = "terminal"
    telegram = "telegram"
    manual = "manual"
    api = "api"


class DayStatus(str, enum.Enum):
    on_time = "on_time"
    late = "late"
    early_leave = "early_leave"
    late_early = "late_early"
    absent = "absent"
    excused = "excused"
    remote = "remote"
    worked_off = "worked_off"  # worked outside schedule / flexible
    leave = "leave"
    dismissed = "dismissed"
    day_off = "day_off"
    holiday = "holiday"
    planned = "planned"  # future day
    not_hired = "not_hired"


class TxType(str, enum.Enum):
    salary = "salary"
    bonus = "bonus"
    fine = "fine"
    payment = "payment"


class RequestKind(str, enum.Enum):
    absent = "absent"
    late = "late"


class RequestStatus(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"


class TaskStatus(str, enum.Enum):
    pending = "pending"
    accepted = "accepted"
    review = "review"
    approved = "approved"
    rejected = "rejected"


class BotKind(str, enum.Enum):
    registration = "registration"
    attendance_feed = "attendance_feed"
    late_absent = "late_absent"


# ---------------------------------------------------------------------------
# Platform level
# ---------------------------------------------------------------------------


class PlatformUser(TimestampMixin, Base):
    __tablename__ = "platform_users"
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    display_name: Mapped[str] = mapped_column(String(128), default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class TariffPlan(TimestampMixin, Base):
    __tablename__ = "tariff_plans"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(64))
    price_per_employee: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    max_employees: Mapped[int] = mapped_column(Integer, default=50)
    max_devices: Mapped[int] = mapped_column(Integer, default=1)
    max_branches: Mapped[int] = mapped_column(Integer, default=1)
    modules: Mapped[dict] = mapped_column(JSON, default=dict)


class Project(TimestampMixin, Base):
    """A tenant (company). Addressed by slug in URL: /{slug}."""

    __tablename__ = "projects"
    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(48), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(128))
    inn: Mapped[str] = mapped_column(String(32), default="")
    address: Mapped[str] = mapped_column(String(255), default="")
    phone: Mapped[str] = mapped_column(String(32), default="")
    email: Mapped[str] = mapped_column(String(128), default="")
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Tashkent")
    language: Mapped[str] = mapped_column(String(8), default="ru")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    settings: Mapped[dict] = mapped_column(JSON, default=dict)

    license: Mapped[License | None] = relationship(back_populates="project", uselist=False)


class License(TimestampMixin, Base):
    __tablename__ = "licenses"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), unique=True)
    plan_name: Mapped[str] = mapped_column(String(64), default="Тест")
    billing_mode: Mapped[str] = mapped_column(String(16), default="test")  # test | paid
    valid_until: Mapped[datetime | None] = mapped_column(TZDateTime)
    max_employees: Mapped[int] = mapped_column(Integer, default=50)
    max_devices: Mapped[int] = mapped_column(Integer, default=1)
    max_branches: Mapped[int] = mapped_column(Integer, default=1)
    amount: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    amount_paid: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    access_blocked: Mapped[bool] = mapped_column(Boolean, default=False)
    block_reason: Mapped[str] = mapped_column(String(255), default="")
    modules: Mapped[dict] = mapped_column(JSON, default=dict)

    project: Mapped[Project] = relationship(back_populates="license")


class Announcement(TimestampMixin, Base):
    __tablename__ = "announcements"
    id: Mapped[int] = mapped_column(primary_key=True)
    text: Mapped[str] = mapped_column(Text, default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    level: Mapped[str] = mapped_column(String(16), default="info")


# ---------------------------------------------------------------------------
# Tenant scoped
# ---------------------------------------------------------------------------


class Branch(TimestampMixin, Base):
    __tablename__ = "branches"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(128))
    address: Mapped[str] = mapped_column(String(255), default="")
    settings: Mapped[dict] = mapped_column(JSON, default=dict)


class CabinetUser(TimestampMixin, Base):
    __tablename__ = "cabinet_users"
    __table_args__ = (UniqueConstraint("project_id", "username", name="uq_cabinet_user"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branches.id", ondelete="SET NULL"))
    username: Mapped[str] = mapped_column(String(64))
    password_hash: Mapped[str] = mapped_column(String(255))
    display_name: Mapped[str] = mapped_column(String(128), default="")
    role: Mapped[UserRole] = mapped_column(Enum(UserRole), default=UserRole.admin)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_password_change: Mapped[datetime | None] = mapped_column(TZDateTime)


class Department(TimestampMixin, Base):
    __tablename__ = "departments"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branches.id", ondelete="SET NULL"))
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id", ondelete="SET NULL"))
    name: Mapped[str] = mapped_column(String(128))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class Position(TimestampMixin, Base):
    __tablename__ = "positions"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id", ondelete="SET NULL"))
    name: Mapped[str] = mapped_column(String(128))


class Schedule(TimestampMixin, Base):
    __tablename__ = "schedules"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(128))
    code: Mapped[str] = mapped_column(String(32), default="")
    color: Mapped[str] = mapped_column(String(16), default="#2563eb")
    type: Mapped[ScheduleType] = mapped_column(Enum(ScheduleType), default=ScheduleType.fixed)
    status: Mapped[str] = mapped_column(String(16), default="active")  # active | draft
    start_time: Mapped[time | None] = mapped_column(Time)
    end_time: Mapped[time | None] = mapped_column(Time)
    lunch_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    lunch_start: Mapped[time | None] = mapped_column(Time)
    lunch_end: Mapped[time | None] = mapped_column(Time)
    late_grace_min: Mapped[int] = mapped_column(Integer, default=10)
    early_grace_min: Mapped[int] = mapped_column(Integer, default=10)
    work_days: Mapped[list] = mapped_column(JSON, default=lambda: [True, True, True, True, True, False, False])
    rest_days_per_month: Mapped[int] = mapped_column(Integer, default=0)
    full_day_threshold_min: Mapped[int | None] = mapped_column(Integer)
    hours_calc: Mapped[HoursCalc] = mapped_column(Enum(HoursCalc), default=HoursCalc.first_last)
    rounding_min: Mapped[int] = mapped_column(Integer, default=0)
    overtime_mode: Mapped[OvertimeMode] = mapped_column(Enum(OvertimeMode), default=OvertimeMode.none)
    overtime_tolerance_min: Mapped[int] = mapped_column(Integer, default=0)
    weekday_rate_pct: Mapped[int] = mapped_column(Integer, default=100)
    weekend_rate_pct: Mapped[int] = mapped_column(Integer, default=0)  # 0 = same as weekday
    overtime_hour_amount: Mapped[float | None] = mapped_column(Numeric(14, 2))

    day_offs: Mapped[list[ScheduleDayOff]] = relationship(cascade="all, delete-orphan")


class ScheduleDayOff(Base):
    __tablename__ = "schedule_day_offs"
    __table_args__ = (UniqueConstraint("schedule_id", "date", name="uq_schedule_dayoff"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    schedule_id: Mapped[int] = mapped_column(ForeignKey("schedules.id", ondelete="CASCADE"), index=True)
    date: Mapped[date] = mapped_column(Date)


class Holiday(Base):
    __tablename__ = "holidays"
    __table_args__ = (UniqueConstraint("project_id", "date", name="uq_holiday"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    date: Mapped[date] = mapped_column(Date)
    name: Mapped[str] = mapped_column(String(128))


class Employee(TimestampMixin, Base):
    __tablename__ = "employees"
    __table_args__ = (
        Index("ix_employee_project_status", "project_id", "status"),
        UniqueConstraint("project_id", "employee_number", name="uq_employee_number"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branches.id", ondelete="SET NULL"))
    department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id", ondelete="SET NULL"))
    position_id: Mapped[int | None] = mapped_column(ForeignKey("positions.id", ondelete="SET NULL"))
    schedule_id: Mapped[int | None] = mapped_column(ForeignKey("schedules.id", ondelete="SET NULL"))
    night_schedule_id: Mapped[int | None] = mapped_column(ForeignKey("schedules.id", ondelete="SET NULL"))
    full_name: Mapped[str] = mapped_column(String(160), index=True)
    phone: Mapped[str] = mapped_column(String(32), default="")
    employee_number: Mapped[str] = mapped_column(String(32))
    hik_person_id: Mapped[str | None] = mapped_column(String(64))
    telegram_chat_id: Mapped[str | None] = mapped_column(String(32), index=True)
    telegram_username: Mapped[str | None] = mapped_column(String(64))
    avatar_path: Mapped[str | None] = mapped_column(String(255))
    status: Mapped[EmployeeStatus] = mapped_column(Enum(EmployeeStatus), default=EmployeeStatus.active)
    work_mode: Mapped[WorkMode] = mapped_column(Enum(WorkMode), default=WorkMode.office)
    schedule_mode: Mapped[ScheduleMode] = mapped_column(Enum(ScheduleMode), default=ScheduleMode.fixed)
    hire_date: Mapped[date | None] = mapped_column(Date)
    dismiss_date: Mapped[date | None] = mapped_column(Date)
    birth_date: Mapped[date | None] = mapped_column(Date)
    auto_fines_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    notes: Mapped[str] = mapped_column(Text, default="")
    # identity document (Uzbekistan: series AA + 7 digits, PINFL 14 digits)
    passport_series: Mapped[str] = mapped_column(String(8), default="")
    passport_number: Mapped[str] = mapped_column(String(16), default="")
    passport_issued_by: Mapped[str] = mapped_column(String(255), default="")
    passport_issue_date: Mapped[date | None] = mapped_column(Date)
    passport_expiry_date: Mapped[date | None] = mapped_column(Date)
    pinfl: Mapped[str] = mapped_column(String(14), default="")
    address: Mapped[str] = mapped_column(String(255), default="")
    deleted_at: Mapped[datetime | None] = mapped_column(TZDateTime)

    department: Mapped[Department | None] = relationship(lazy="joined")
    position: Mapped[Position | None] = relationship(lazy="joined")
    schedule: Mapped[Schedule | None] = relationship(foreign_keys=[schedule_id], lazy="joined")
    night_schedule: Mapped[Schedule | None] = relationship(foreign_keys=[night_schedule_id], lazy="joined")
    salary_rates: Mapped[list[SalaryRate]] = relationship(
        cascade="all, delete-orphan", order_by="SalaryRate.effective_from.desc()", lazy="selectin"
    )


class SalaryRate(TimestampMixin, Base):
    __tablename__ = "salary_rates"
    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"), index=True)
    rate_type: Mapped[RateType] = mapped_column(Enum(RateType), default=RateType.monthly)
    amount: Mapped[float] = mapped_column(Numeric(14, 2))
    effective_from: Mapped[date] = mapped_column(Date)


class PieceworkEntry(TimestampMixin, Base):
    """Выработка сдельщика за день: количество единиц × ставка за единицу = заработок."""
    __tablename__ = "piecework_entries"
    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"), index=True)
    work_date: Mapped[date] = mapped_column(Date, index=True)
    quantity: Mapped[float] = mapped_column(Numeric(12, 2))
    note: Mapped[str] = mapped_column(String(255), default="")


class Device(TimestampMixin, Base):
    __tablename__ = "devices"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branches.id", ondelete="SET NULL"))
    name: Mapped[str] = mapped_column(String(128))
    serial: Mapped[str] = mapped_column(String(64), default="")
    password: Mapped[str] = mapped_column(String(128), default="")
    direction: Mapped[str] = mapped_column(String(8), default="both")  # in | out | both
    hik_device_id: Mapped[str | None] = mapped_column(String(64))
    hik_door_index: Mapped[str | None] = mapped_column(String(64))
    last_seen_at: Mapped[datetime | None] = mapped_column(TZDateTime)
    is_online: Mapped[bool] = mapped_column(Boolean, default=False)


class AttendanceEvent(Base):
    """Raw pass (check-in/out) from a terminal, Telegram or manual entry."""

    __tablename__ = "attendance_events"
    __table_args__ = (
        Index("ix_event_emp_time", "employee_id", "event_time"),
        Index("ix_event_project_time", "project_id", "event_time"),
        UniqueConstraint("project_id", "external_id", name="uq_event_external"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"))
    device_id: Mapped[int | None] = mapped_column(ForeignKey("devices.id", ondelete="SET NULL"))
    event_time: Mapped[datetime] = mapped_column(TZDateTime)
    direction: Mapped[EventDirection] = mapped_column(Enum(EventDirection))
    source: Mapped[EventSource] = mapped_column(Enum(EventSource), default=EventSource.terminal)
    external_id: Mapped[str | None] = mapped_column(String(128))
    device_label: Mapped[str] = mapped_column(String(128), default="")
    photo_path: Mapped[str | None] = mapped_column(String(255))
    hidden: Mapped[bool] = mapped_column(Boolean, default=False)  # excluded from timesheet by admin
    created_at: Mapped[datetime] = mapped_column(TZDateTime, default=utcnow)


class AttendanceDay(TimestampMixin, Base):
    """Materialised day record per employee. Recomputed from events unless is_manual."""

    __tablename__ = "attendance_days"
    __table_args__ = (UniqueConstraint("employee_id", "date", name="uq_attendance_day"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"), index=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    status: Mapped[DayStatus] = mapped_column(Enum(DayStatus), default=DayStatus.absent)
    check_in: Mapped[datetime | None] = mapped_column(TZDateTime)
    check_out: Mapped[datetime | None] = mapped_column(TZDateTime)
    worked_minutes: Mapped[int] = mapped_column(Integer, default=0)
    scheduled_minutes: Mapped[int] = mapped_column(Integer, default=0)
    overtime_minutes: Mapped[int] = mapped_column(Integer, default=0)
    late_minutes: Mapped[int] = mapped_column(Integer, default=0)
    early_leave_minutes: Mapped[int] = mapped_column(Integer, default=0)
    schedule_id: Mapped[int | None] = mapped_column(ForeignKey("schedules.id", ondelete="SET NULL"))
    is_manual: Mapped[bool] = mapped_column(Boolean, default=False)
    manual_status: Mapped[DayStatus | None] = mapped_column(Enum(DayStatus))
    manual_check_in: Mapped[datetime | None] = mapped_column(TZDateTime)
    manual_check_out: Mapped[datetime | None] = mapped_column(TZDateTime)
    day_off_override: Mapped[bool] = mapped_column(Boolean, default=False)
    comment: Mapped[str] = mapped_column(String(255), default="")
    edited_by: Mapped[str] = mapped_column(String(64), default="")


class PayrollTransaction(TimestampMixin, Base):
    __tablename__ = "payroll_transactions"
    __table_args__ = (
        Index("ix_tx_project_date", "project_id", "tx_date"),
        Index("ix_tx_employee_period", "employee_id", "period_year", "period_month"),
        UniqueConstraint("employee_id", "auto_key", name="uq_tx_auto_key"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"))
    type: Mapped[TxType] = mapped_column(Enum(TxType))
    amount: Mapped[float] = mapped_column(Numeric(14, 2))  # positive numbers; sign derived from type
    tx_date: Mapped[date] = mapped_column(Date)
    period_year: Mapped[int] = mapped_column(Integer)
    period_month: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(String(255), default="")
    comment: Mapped[str] = mapped_column(Text, default="")
    auto_key: Mapped[str | None] = mapped_column(String(64))  # e.g. auto:late:2026-09-18
    meta: Mapped[dict] = mapped_column(JSON, default=dict)
    created_by: Mapped[str] = mapped_column(String(64), default="system")
    deleted_at: Mapped[datetime | None] = mapped_column(TZDateTime)
    deleted_by: Mapped[str | None] = mapped_column(String(64))


class AbsenceRequest(TimestampMixin, Base):
    __tablename__ = "absence_requests"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"))
    kind: Mapped[RequestKind] = mapped_column(Enum(RequestKind))
    request_date: Mapped[date] = mapped_column(Date)
    late_minutes: Mapped[int] = mapped_column(Integer, default=0)
    expected_time: Mapped[time | None] = mapped_column(Time)
    reason: Mapped[str] = mapped_column(Text, default="")
    photo_path: Mapped[str | None] = mapped_column(String(255))
    status: Mapped[RequestStatus] = mapped_column(Enum(RequestStatus), default=RequestStatus.pending)
    submitted_via: Mapped[str] = mapped_column(String(64), default="telegram")
    decided_by: Mapped[str | None] = mapped_column(String(64))
    decided_at: Mapped[datetime | None] = mapped_column(TZDateTime)
    decision_comment: Mapped[str] = mapped_column(String(255), default="")


class Task(TimestampMixin, Base):
    __tablename__ = "tasks"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(160))
    description: Mapped[str] = mapped_column(Text, default="")
    bonus_amount: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    photo_path: Mapped[str | None] = mapped_column(String(255))
    result_text: Mapped[str] = mapped_column(Text, default="")
    result_photo_path: Mapped[str | None] = mapped_column(String(255))
    status: Mapped[TaskStatus] = mapped_column(Enum(TaskStatus), default=TaskStatus.pending)
    created_by: Mapped[str] = mapped_column(String(64), default="")
    accepted_at: Mapped[datetime | None] = mapped_column(TZDateTime)
    completed_at: Mapped[datetime | None] = mapped_column(TZDateTime)
    reviewed_at: Mapped[datetime | None] = mapped_column(TZDateTime)
    reviewed_by: Mapped[str | None] = mapped_column(String(64))
    bonus_tx_id: Mapped[int | None] = mapped_column(ForeignKey("payroll_transactions.id", ondelete="SET NULL"))


class BotSubscriber(TimestampMixin, Base):
    __tablename__ = "bot_subscribers"
    __table_args__ = (UniqueConstraint("project_id", "bot_kind", "chat_id", name="uq_bot_subscriber"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    bot_kind: Mapped[BotKind] = mapped_column(Enum(BotKind))
    chat_id: Mapped[str] = mapped_column(String(32))
    username: Mapped[str] = mapped_column(String(64), default="")
    full_name: Mapped[str] = mapped_column(String(128), default="")
    status: Mapped[RequestStatus] = mapped_column(Enum(RequestStatus), default=RequestStatus.pending)


class ApiKey(TimestampMixin, Base):
    __tablename__ = "api_keys"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(64))
    prefix: Mapped[str] = mapped_column(String(24))
    key_hash: Mapped[str] = mapped_column(String(128), index=True)
    last_used_at: Mapped[datetime | None] = mapped_column(TZDateTime)
    revoked_at: Mapped[datetime | None] = mapped_column(TZDateTime)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    __table_args__ = (Index("ix_audit_project_time", "project_id", "created_at"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    actor: Mapped[str] = mapped_column(String(64), default="")
    ip: Mapped[str] = mapped_column(String(64), default="")
    user_agent: Mapped[str] = mapped_column(String(255), default="")
    category: Mapped[str] = mapped_column(String(32), default="other")  # auth, employees, finance, attendance...
    action: Mapped[str] = mapped_column(String(64), default="")
    entity_type: Mapped[str] = mapped_column(String(32), default="")
    entity_id: Mapped[int | None] = mapped_column(Integer)
    details: Mapped[str] = mapped_column(Text, default="")
    amount: Mapped[float | None] = mapped_column(Numeric(14, 2))
    created_at: Mapped[datetime] = mapped_column(TZDateTime, default=utcnow, index=True)
