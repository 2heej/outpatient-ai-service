import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://opd:opd@localhost:5432/opd_test")
os.environ.setdefault("STAFF_ACCESS_CODE", "test-staff-code")
os.environ.setdefault("USE_LLM_SUMMARY", "false")

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import get_settings
from app.db import Base, get_db
from app.main import app
from app.rate_limit import limiter

settings = get_settings()
test_engine = create_async_engine(settings.database_url, poolclass=NullPool)
TestSessionLocal = async_sessionmaker(test_engine, expire_on_commit=False)


async def _override_get_db():
    async with TestSessionLocal() as session:
        yield session


app.dependency_overrides[get_db] = _override_get_db


@pytest_asyncio.fixture(autouse=True)
async def _reset_db():
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    limiter.reset()
    yield


@pytest_asyncio.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.fixture
def staff_headers():
    return {"X-Staff-Code": settings.staff_access_code}


@pytest.fixture
def sample_submission():
    return {
        "disease_context": "치매",
        "visit_purpose": ["증상 상담"],
        "symptom_change": "나빠짐",
        "requested_consultation": "요즘 기억력이 더 나빠진 것 같아요",
        "document_type": [],
        "document_destination": [],
        "visit_type": "patient",
    }
