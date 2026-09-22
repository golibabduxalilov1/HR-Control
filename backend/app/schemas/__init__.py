from __future__ import annotations

from datetime import date, datetime, time
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ------------------------------------------------------------------ auth


class LoginIn(BaseModel):
    username: str
    password: str
    project_slug: str | None = None


class LoginOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    project_slug: str
    display_name: str
    role: str
    branch_id: int | None
    branch_name: str | None
    is_hq: bool


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=6)


# ------------------------------------------------------------------ structure


class BranchIn(BaseModel):
    name: str
    address: str = ""


class BranchOut(ORM):
    id: int
    name: str
    address: str
    employee_count: int = 0


class DepartmentIn(BaseModel):
    name: str
    parent_id: int | None = None
    branch_id: int | None = None


class DepartmentOut(ORM):
    id: int
    name: str
    parent_id: int | None
    branch_id: int | None
    employee_count: int = 0
    children: list[DepartmentOut] = []


class PositionIn(BaseModel):
    name: str
    department_id: int | None = None


class PositionOut(ORM):
    id: int
    name: str
    department_id: int | None
    department_name: str | None = None
    employee_count: int = 0


class AssignEmployeesIn(BaseModel):
    employee_ids: list[int]


# ------------------------------------------------------------------ schedules


class ScheduleIn(BaseModel):
    name: str
    code: str = ""
    color: str = "#2563eb"
    type: Literal["fixed", "flexible", "shift"] = "fixed"
    status: Literal["active", "draft"] = "active"
    start_time: time | None = None
    end_time: time | None = None
    lunch_enabled: bool = False
    lunch_start: time | None = None
    lunch_end: time | None = None
    late_grace_min: int = 10
    early_grace_min: int = 10
    work_days: list[bool] = Field(default_factory=lambda: [True, True, True, True, True, False, False])
    rest_days_per_month: int = 0
    full_day_threshold_min: int | None = None
    hours_calc: Literal["first_last", "sessions"] = "first_last"
    rounding_min: int = 0
    overtime_mode: Literal["none", "full_day", "overtime_only"] = "none"
    overtime_tolerance_min: int = 0
    weekday_rate_pct: int = 100
    weekend_rate_pct: int = 0
    overtime_hour_amount: Decimal | None = None


class ScheduleOut(ScheduleIn, ORM):
    id: int
    employee_count: int = 0
    day_offs: list[date] = []


class DayOffIn(BaseModel):
    date: date


class HolidayIn(BaseModel):
    date: date
    name: str


class HolidayOut(ORM):
    id: int
    date: date
    name: str


# ------------------------------------------------------------------ employees


class SalaryRateIn(BaseModel):
    rate_type: Literal["monthly", "hourly", "piece"] = "monthly"
    amount: Decimal
    effective_from: date


class SalaryRateOut(SalaryRateIn, ORM):
    id: int
    created_at: datetime


class PieceworkIn(BaseModel):
    work_date: date
    quantity: Decimal = Field(gt=0)
    note: str = Field(default="", max_length=255)


class PieceworkOut(PieceworkIn, ORM):
    id: int
    created_at: datetime


class EmployeeIn(BaseModel):
    full_name: str = Field(min_length=1, max_length=160)
    phone: str = ""
    employee_number: str | None = None
    department_id: int | None = None
    position_id: int | None = None
    branch_id: int | None = None
    schedule_id: int | None = None
    night_schedule_id: int | None = None
    schedule_mode: Literal["fixed", "two_shifts", "flexible"] = "fixed"
    work_mode: Literal["office", "remote", "hybrid"] = "office"
    status: Literal["active", "leave", "dismissed"] = "active"
    hire_date: date | None = None
    dismiss_date: date | None = None
    birth_date: date | None = None
    telegram_chat_id: str | None = None
    auto_fines_enabled: bool = True
    notes: str = ""
    hik_person_id: str | None = None
    passport_series: str = ""
    passport_number: str = ""
    passport_issued_by: str = ""
    passport_issue_date: date | None = None
    passport_expiry_date: date | None = None
    pinfl: str = ""
    address: str = ""
    salary_rate: SalaryRateIn | None = None  # convenience on create

    @field_validator("pinfl")
    @classmethod
    def _pinfl(cls, v: str) -> str:
        v = (v or "").strip()
        if v and (not v.isdigit() or len(v) != 14):
            raise ValueError("ПИНФЛ — 14 цифр")
        return v

    @field_validator("passport_series")
    @classmethod
    def _series(cls, v: str) -> str:
        return (v or "").strip().upper()

    @field_validator("passport_number")
    @classmethod
    def _number(cls, v: str) -> str:
        return (v or "").strip()


class EmployeeOut(ORM):
    id: int
    full_name: str
    phone: str
    employee_number: str
    department_id: int | None
    department_name: str | None = None
    position_id: int | None
    position_name: str | None = None
    branch_id: int | None
    schedule_id: int | None
    schedule_name: str | None = None
    schedule_label: str | None = None
    night_schedule_id: int | None
    schedule_mode: str
    work_mode: str
    status: str
    hire_date: date | None
    dismiss_date: date | None
    birth_date: date | None
    telegram_chat_id: str | None
    telegram_username: str | None
    hik_person_id: str | None
    avatar_url: str | None = None
    auto_fines_enabled: bool
    notes: str
    passport_series: str = ""
    passport_number: str = ""
    passport_issued_by: str = ""
    passport_issue_date: date | None = None
    passport_expiry_date: date | None = None
    pinfl: str = ""
    address: str = ""
    current_rate: SalaryRateOut | None = None
    salary_rates: list[SalaryRateOut] = []
    created_at: datetime


class EmployeeStats(BaseModel):
    total: int
    active: int
    on_leave: int
    dismissed: int


class Paginated(BaseModel):
    items: list[Any]
    total: int
    page: int
    per_page: int


# ------------------------------------------------------------------ attendance


class EventOut(ORM):
    id: int
    employee_id: int
    employee_name: str | None = None
    event_time: datetime
    direction: str
    source: str
    device_label: str
    hidden: bool
    photo_url: str | None = None


class ManualEventIn(BaseModel):
    employee_id: int
    event_time: datetime
    direction: Literal["in", "out"]
    comment: str = ""


class DayOut(BaseModel):
    date: date
    status: str
    check_in: datetime | None
    check_out: datetime | None
    worked_minutes: int
    scheduled_minutes: int
    overtime_minutes: int
    late_minutes: int
    early_leave_minutes: int
    is_manual: bool
    schedule_id: int | None
    schedule_label: str | None = None
    day_off_override: bool = False
    comment: str = ""
    is_holiday: bool = False
    holiday_name: str | None = None
    events: list[EventOut] = []


class DayEditIn(BaseModel):
    status: str | None = None  # manual status or null to reset
    check_in: datetime | None = None
    check_out: datetime | None = None
    schedule_id: int | None = None
    day_off_override: bool | None = None
    hidden_event_ids: list[int] = []
    unhidden_event_ids: list[int] = []
    flip_event_ids: list[int] = []
    comment: str = ""
    reset: bool = False


class BulkDayEditIn(BaseModel):
    employee_ids: list[int]
    dates: list[date]
    status: str
    comment: str = ""


class EmployeeTimesheetOut(BaseModel):
    employee: EmployeeOut
    year: int
    month: int
    days: list[DayOut]
    summary: dict[str, Any]


# ------------------------------------------------------------------ payroll


class TransactionIn(BaseModel):
    employee_id: int
    type: Literal["salary", "bonus", "fine", "payment"]
    amount: Decimal = Field(gt=0)
    tx_date: date | None = None
    reason: str = ""
    comment: str = ""


class TransactionUpdateIn(BaseModel):
    amount: Decimal | None = Field(default=None, gt=0)
    reason: str | None = None
    comment: str | None = None
    tx_date: date | None = None


class TransactionOut(ORM):
    id: int
    employee_id: int
    employee_name: str | None = None
    department_name: str | None = None
    position_name: str | None = None
    type: str
    amount: Decimal
    signed_amount: Decimal | None = None
    tx_date: date
    reason: str
    comment: str
    auto_key: str | None
    created_by: str
    created_at: datetime
    deleted_at: datetime | None
    balance_after: Decimal | None = None


class AccrueIn(BaseModel):
    year: int
    month: int


# ------------------------------------------------------------------ requests / tasks


class AbsenceRequestOut(ORM):
    id: int
    employee_id: int
    employee_name: str | None = None
    department_name: str | None = None
    position_name: str | None = None
    kind: str
    request_date: date
    late_minutes: int
    expected_time: time | None
    reason: str
    photo_url: str | None = None
    status: str
    submitted_via: str
    decided_by: str | None
    decided_at: datetime | None
    decision_comment: str
    created_at: datetime


class DecisionIn(BaseModel):
    decision: Literal["approved", "rejected"]
    comment: str = ""
    apply_fine: bool | None = None


class TaskIn(BaseModel):
    employee_id: int
    title: str
    description: str = ""
    bonus_amount: Decimal = Decimal(0)


class TaskOut(ORM):
    id: int
    employee_id: int
    employee_name: str | None = None
    department_name: str | None = None
    position_name: str | None = None
    title: str
    description: str
    bonus_amount: Decimal
    photo_url: str | None = None
    result_text: str
    result_photo_url: str | None = None
    status: str
    created_by: str
    created_at: datetime
    accepted_at: datetime | None
    completed_at: datetime | None
    reviewed_at: datetime | None
    reviewed_by: str | None


# ------------------------------------------------------------------ users / devices / keys


class CabinetUserIn(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=6)
    display_name: str = ""
    role: Literal["admin", "operator", "hr", "manager"] = "operator"
    branch_id: int | None = None


class CabinetUserOut(ORM):
    id: int
    username: str
    display_name: str
    role: str
    branch_id: int | None
    branch_name: str | None = None
    is_active: bool


class DeviceIn(BaseModel):
    name: str
    serial: str = ""
    password: str = ""
    direction: Literal["in", "out", "both"] = "both"
    branch_id: int | None = None
    hik_device_id: str | None = None
    hik_door_index: str | None = None


class DeviceOut(ORM):
    id: int
    name: str
    serial: str
    direction: str
    branch_id: int | None
    hik_device_id: str | None
    hik_door_index: str | None
    last_seen_at: datetime | None
    is_online: bool


class ApiKeyOut(ORM):
    id: int
    name: str
    prefix: str
    created_at: datetime
    last_used_at: datetime | None
    revoked_at: datetime | None


class ApiKeyCreated(ApiKeyOut):
    key: str


class AuditOut(ORM):
    id: int
    actor: str
    ip: str
    user_agent: str
    category: str
    action: str
    details: str
    amount: Decimal | None
    created_at: datetime


# ------------------------------------------------------------------ platform


class ProjectIn(BaseModel):
    slug: str = Field(pattern=r"^[a-z][a-z0-9-]{1,46}$")
    name: str
    admin_username: str = "admin"
    admin_password: str = Field(min_length=4)
    timezone: str = "Asia/Tashkent"
    language: str = "ru"
    plan_name: str = "Тест"
    max_employees: int = 50
    max_devices: int = 1
    max_branches: int = 1
    valid_until: datetime | None = None


class ProjectOut(ORM):
    id: int
    slug: str
    name: str
    timezone: str
    language: str
    is_active: bool
    created_at: datetime
    employee_count: int = 0
    license: dict | None = None


class LicenseOut(BaseModel):
    plan_name: str
    billing_mode: str
    is_test_mode: bool
    valid_until: datetime | None
    days_remaining: int | None
    max_employees: int
    max_devices: int
    max_branches: int
    employee_count: int
    device_count: int
    branch_count: int
    access_blocked: bool
    block_reason: str
    amount: Decimal
    amount_paid: Decimal
    modules: dict


class SettingsPatch(BaseModel):
    """Free-form settings patch; keys validated against DEFAULT_SETTINGS + secret keys."""

    model_config = ConfigDict(extra="allow")
