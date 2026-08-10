import datetime

from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import Intake

settings = get_settings()

limiter = Limiter(key_func=get_remote_address, default_limits=[f"{settings.rate_limit_per_minute}/minute"])


async def llm_calls_today(db: AsyncSession) -> int:
    today_start = datetime.datetime.now(datetime.UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    result = await db.execute(
        select(func.count())
        .select_from(Intake)
        .where(Intake.fallback_used.is_(False), Intake.created_at >= today_start)
    )
    return result.scalar_one()


async def llm_calls_allowed(db: AsyncSession) -> bool:
    return await llm_calls_today(db) < settings.daily_llm_call_cap
