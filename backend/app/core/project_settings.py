"""Tenant settings stored in projects.settings JSON, with defaults."""

from __future__ import annotations

from typing import Any

DEFAULT_SETTINGS: dict[str, Any] = {
    # modules
    "finance_enabled": True,
    "tasks_enabled": True,
    "auto_accrue_on_checkout": False,
    "show_payday": True,
    # locale
    "language": "ru",
    "date_format": "dd.mm.yyyy",
    "time_format": "24h",
    "currency": "UZS",
    "week_start": "monday",
    "dashboard_view": "attendance",
    "site_theme": "arctic",
    "theme_mode": "light",
    "brand_color": "",  # hex like #2f5bea; empty = theme accent
    # work time
    "worktime_mode": "fixed",  # fixed | flexible
    "workday_start": "08:00",
    "late_grace_min": 15,
    "min_work_hours": 4,
    "time_rounding_min": 5,
    "day_close_hour": 6,  # events before this hour belong to previous day
    "auto_late_calc": True,
    "include_lunch": False,
    "flexible_include_lunch": False,
    "lunch_start_default": "12:00",
    "lunch_end_default": "13:00",
    "lunch_tracking_enabled": False,
    "exit_watch_enabled": False,
    "allow_overtime": True,
    "overtime_after_min": 15,
    "weekly_norm_hours": 40,
    "require_location": False,
    "auto_sync": True,
    "hours_calc_default_mode": "first_last",
    # auto fines
    "auto_fines_enabled": False,
    "auto_fines_from_date": None,
    "auto_fine_late_enabled": True,
    "auto_fine_late_amount": 20000,
    "auto_fine_late_per_hour": False,
    "auto_fine_late_per_hour_amount": 0,
    "auto_fine_late_per_minute": False,
    "auto_fine_late_per_minute_amount": 0,
    "auto_fine_early_enabled": False,
    "auto_fine_early_amount": 50000,
    "auto_fine_absent_enabled": False,
    "auto_fine_absent_amount": 200000,
    # statuses (customisable labels)
    "employment_statuses": [
        {"id": "active", "label": "Активный", "builtin": True, "enabled": True, "sort_order": 0},
        {"id": "leave", "label": "В отпуске", "builtin": True, "enabled": True, "sort_order": 1},
        {"id": "dismissed", "label": "Уволен", "builtin": True, "enabled": True, "sort_order": 2},
    ],
    "attendance_day_statuses": [
        {"id": "on_time", "label": "Вовремя", "builtin": True, "enabled": True, "sort_order": 0},
        {"id": "late", "label": "Опоздание", "builtin": True, "enabled": True, "sort_order": 1},
        {"id": "early_leave", "label": "Ран. уход", "builtin": True, "enabled": True, "sort_order": 2},
        {"id": "absent", "label": "Отсутствует", "builtin": True, "enabled": True, "sort_order": 3},
        {"id": "excused", "label": "Уваж. причина", "builtin": True, "enabled": True, "sort_order": 4},
        {"id": "remote", "label": "Удалённо", "builtin": True, "enabled": True, "sort_order": 5},
        {"id": "worked_off", "label": "Отработано", "builtin": True, "enabled": True, "sort_order": 6},
        {"id": "leave", "label": "Отпуск", "builtin": True, "enabled": True, "sort_order": 7},
        {"id": "dismissed", "label": "Уволен", "builtin": True, "enabled": True, "sort_order": 8},
    ],
    # telegram
    "telegram_default_lang": "ru",
    "telegram_manager_employee_ids": [],
    "telegram_hr_employee_ids": [],
    "telegram_manager_chat_ids": [],
    "telegram_hr_chat_ids": [],
    "telegram_chat_id": "",
    "attendance_feed_enabled": False,
    "attendance_feed_chat_ids": [],
    "late_absent_enabled": False,
    "late_absent_chat_ids": [],
    "late_absent_after_hours": 2,
    # hikcentral
    "hik_enabled": False,
    "hik_base_url": "",
    "hik_app_key": "",
    "hik_app_secret": "",
    "hik_verify_ssl": False,
    "hik_last_event_time": None,
    # notifications
    "notify_telegram": True,
    "notify_new_device": True,
    "notify_failed_login": True,
}

# keys whose values must never be returned to non-admin users or in public endpoints
SECRET_KEYS = {
    "telegram_bot_token",
    "attendance_feed_bot_token",
    "late_absent_bot_token",
    "hik_app_secret",
}


def merged_settings(raw: dict[str, Any] | None) -> dict[str, Any]:
    data = dict(DEFAULT_SETTINGS)
    if raw:
        data.update(raw)
    return data


def public_settings(raw: dict[str, Any] | None) -> dict[str, Any]:
    """Settings safe for the cabinet UI: secrets replaced by a boolean flag."""
    data = merged_settings(raw)
    for key in SECRET_KEYS:
        data[f"{key}_set"] = bool(data.get(key))
        data.pop(key, None)
    return data
