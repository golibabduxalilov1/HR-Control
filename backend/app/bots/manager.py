"""Runs one aiogram polling loop per (project, bot kind). Reloadable when tokens change."""

from __future__ import annotations

import asyncio
import logging

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.fsm.storage.memory import MemoryStorage
from sqlalchemy import select

from app.core.project_settings import merged_settings
from app.db.session import SessionLocal
from app.models import Project

log = logging.getLogger("bots")

TOKEN_KEYS = {"registration": "telegram_bot_token", "attendance_feed": "attendance_feed_bot_token", "late_absent": "late_absent_bot_token"}


class BotManager:
    def __init__(self) -> None:
        self._tasks: dict[tuple[int, str], asyncio.Task] = {}
        self._bots: dict[tuple[int, str], Bot] = {}
        self._tokens: dict[tuple[int, str], str] = {}
        self._enabled = True

    # -- lifecycle -----------------------------------------------------------------------

    async def start_all(self) -> None:
        async with SessionLocal() as db:
            projects = (await db.execute(select(Project).where(Project.is_active.is_(True)))).scalars().all()
            for p in projects:
                await self._start_project(p)

    async def reload_project(self, project_id: int) -> None:
        async with SessionLocal() as db:
            p = await db.get(Project, project_id)
            if p:
                await self._start_project(p)

    async def _start_project(self, project: Project) -> None:
        s = merged_settings(project.settings)
        for kind, key in TOKEN_KEYS.items():
            token = (s.get(key) or "").strip()
            enabled = token and (kind == "registration" or s.get(f"{kind}_enabled", False))
            k = (project.id, kind)
            if not enabled:
                await self._stop(k)
                continue
            if self._tokens.get(k) == token and k in self._tasks and not self._tasks[k].done():
                continue
            await self._stop(k)
            await self._start(k, token, project.id, kind)

    async def _start(self, key: tuple[int, str], token: str, project_id: int, kind: str) -> None:
        from app.bots.handlers import build_dispatcher

        bot = Bot(token=token, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
        dp: Dispatcher = build_dispatcher(kind, project_id, MemoryStorage())
        self._bots[key], self._tokens[key] = bot, token

        async def runner():
            try:
                await bot.delete_webhook(drop_pending_updates=False)
                await dp.start_polling(bot, handle_signals=False, project_id=project_id, bot_kind=kind)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                log.warning("bot %s/%s stopped: %s", project_id, kind, exc)
            finally:
                await bot.session.close()

        self._tasks[key] = asyncio.create_task(runner(), name=f"bot-{project_id}-{kind}")
        log.info("started bot %s for project %s", kind, project_id)

    async def _stop(self, key: tuple[int, str]) -> None:
        task = self._tasks.pop(key, None)
        self._bots.pop(key, None)
        self._tokens.pop(key, None)
        if task and not task.done():
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass

    async def stop_all(self) -> None:
        for key in list(self._tasks):
            await self._stop(key)

    def is_running(self, project_id: int, kind: str) -> bool:
        t = self._tasks.get((project_id, kind))
        return bool(t and not t.done())

    # -- messaging -----------------------------------------------------------------------

    def bot(self, project_id: int, kind: str) -> Bot | None:
        return self._bots.get((project_id, kind))

    async def get_me(self, token: str) -> dict:
        bot = Bot(token=token)
        try:
            me = await bot.get_me()
            return {"id": me.id, "username": me.username, "first_name": me.first_name}
        finally:
            await bot.session.close()

    async def send(self, token_or_kind: str, chat_id: str | int, text: str, project_id: int | None = None, photo: str | None = None, reply_markup=None) -> None:
        bot = self._bots.get((project_id, token_or_kind)) if project_id is not None else None
        temp = None
        if bot is None:
            temp = bot = Bot(token=token_or_kind, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
        try:
            if photo:
                from aiogram.types import FSInputFile
                await bot.send_photo(chat_id, FSInputFile(photo), caption=text, reply_markup=reply_markup)
            else:
                await bot.send_message(chat_id, text, reply_markup=reply_markup)
        finally:
            if temp:
                await temp.session.close()


bot_manager = BotManager()
