import pytest

from app import llm as llm_module
from app.config import get_settings


@pytest.mark.asyncio
async def test_submit_intake_falls_back_without_llm(client, sample_submission):
    response = await client.post("/api/intake", json=sample_submission)
    assert response.status_code == 201
    body = response.json()
    assert body["fallback_used"] is True
    assert body["llm_model"] is None
    assert body["subjective_summary"]
    assert body["soap_summary"]
    assert body["patient_present"] is True
    assert body["guardian_only"] is False


@pytest.mark.asyncio
async def test_guardian_only_visit_sets_flags(client, sample_submission):
    sample_submission["visit_type"] = "guardian_only"
    response = await client.post("/api/intake", json=sample_submission)
    assert response.status_code == 201
    body = response.json()
    assert body["patient_present"] is False
    assert body["guardian_only"] is True


@pytest.mark.asyncio
async def test_submit_intake_uses_llm_when_available(client, sample_submission, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "use_llm_summary", True)
    monkeypatch.setattr(settings, "openai_api_key", "test-key")
    monkeypatch.setattr(
        llm_module,
        "call_llm_summary",
        lambda submission: ("LLM 요약 결과", "S: ... O: 해당 없음. A: 진단 생성하지 않음. P: 확인 필요."),
    )

    response = await client.post("/api/intake", json=sample_submission)
    assert response.status_code == 201
    body = response.json()
    assert body["fallback_used"] is False
    assert body["llm_model"] == settings.openai_model
    assert body["subjective_summary"] == "LLM 요약 결과"


@pytest.mark.asyncio
async def test_llm_failure_falls_back(client, sample_submission, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "use_llm_summary", True)
    monkeypatch.setattr(settings, "openai_api_key", "test-key")

    def _boom(submission):
        raise RuntimeError("simulated API failure")

    monkeypatch.setattr(llm_module, "call_llm_summary", _boom)

    response = await client.post("/api/intake", json=sample_submission)
    assert response.status_code == 201
    body = response.json()
    assert body["fallback_used"] is True
    assert body["llm_model"] is None


@pytest.mark.asyncio
async def test_daily_cap_forces_fallback(client, sample_submission, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "use_llm_summary", True)
    monkeypatch.setattr(settings, "openai_api_key", "test-key")
    monkeypatch.setattr(settings, "daily_llm_call_cap", 0)
    monkeypatch.setattr(
        llm_module, "call_llm_summary", lambda submission: ("should not be used", "should not be used")
    )

    response = await client.post("/api/intake", json=sample_submission)
    assert response.status_code == 201
    body = response.json()
    assert body["fallback_used"] is True


@pytest.mark.asyncio
async def test_list_requires_staff_code(client, sample_submission):
    await client.post("/api/intake", json=sample_submission)
    response = await client.get("/api/intake")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_list_and_get_with_staff_code(client, sample_submission, staff_headers):
    submit_response = await client.post("/api/intake", json=sample_submission)
    intake_id = submit_response.json()["id"]

    list_response = await client.get("/api/intake", headers=staff_headers)
    assert list_response.status_code == 200
    assert any(item["id"] == intake_id for item in list_response.json())

    detail_response = await client.get(f"/api/intake/{intake_id}", headers=staff_headers)
    assert detail_response.status_code == 200
    assert detail_response.json()["id"] == intake_id


@pytest.mark.asyncio
async def test_get_missing_intake_404(client, staff_headers):
    response = await client.get(
        "/api/intake/00000000-0000-0000-0000-000000000000", headers=staff_headers
    )
    assert response.status_code == 404
