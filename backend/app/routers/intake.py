import uuid

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_db
from app.llm import detect_risk, generate_summary
from app.models import Intake
from app.rate_limit import limiter, llm_calls_allowed
from app.schemas import IntakeListItem, IntakeResponse, IntakeSubmission

router = APIRouter(prefix="/api/intake", tags=["intake"])
settings = get_settings()


def require_staff(x_staff_code: str = Header(default="")) -> None:
    if x_staff_code != settings.staff_access_code:
        raise HTTPException(status_code=401, detail="직원 인증이 필요합니다.")


def _derive_visit_flags(visit_type: str) -> tuple[bool, bool]:
    if visit_type == "guardian_only":
        return False, True
    return True, False


@router.post("", response_model=IntakeResponse, status_code=201)
@limiter.limit(f"{settings.rate_limit_per_minute}/minute")
async def submit_intake(
    request: Request, submission: IntakeSubmission, db: AsyncSession = Depends(get_db)
) -> Intake:
    patient_present, guardian_only = _derive_visit_flags(submission.visit_type)
    allow_llm = await llm_calls_allowed(db)

    subjective_summary, soap_summary, llm_model, fallback_used = generate_summary(
        submission, patient_present, guardian_only, allow_llm
    )

    intake = Intake(
        disease_context=submission.disease_context,
        visit_purpose=submission.visit_purpose,
        symptom_change=submission.symptom_change,
        document_type=submission.document_type,
        document_destination=submission.document_destination,
        patient_present=patient_present,
        guardian_only=guardian_only,
        requested_consultation=submission.requested_consultation,
        subjective_summary=subjective_summary,
        soap_summary=soap_summary,
        raw_answers=submission.model_dump(),
        llm_model=llm_model,
        fallback_used=fallback_used,
        flagged_for_review=detect_risk((submission.requested_consultation or "").strip()),
    )
    db.add(intake)
    await db.commit()
    await db.refresh(intake)
    return intake


@router.get("", response_model=list[IntakeListItem], dependencies=[Depends(require_staff)])
async def list_intakes(
    disease_context: str | None = Query(default=None),
    flagged_only: bool = Query(default=False),
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
) -> list[Intake]:
    stmt = select(Intake).order_by(Intake.created_at.desc()).offset(offset).limit(limit)
    if disease_context:
        stmt = stmt.where(Intake.disease_context == disease_context)
    if flagged_only:
        stmt = stmt.where(Intake.flagged_for_review.is_(True))
    result = await db.execute(stmt)
    return list(result.scalars().all())


@router.get("/{intake_id}", response_model=IntakeResponse, dependencies=[Depends(require_staff)])
async def get_intake(intake_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> Intake:
    result = await db.execute(select(Intake).where(Intake.id == intake_id))
    intake = result.scalar_one_or_none()
    if intake is None:
        raise HTTPException(status_code=404, detail="문진 기록을 찾을 수 없습니다.")
    return intake
