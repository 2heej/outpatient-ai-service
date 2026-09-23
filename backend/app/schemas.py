"""Field schema ported from outpatient-ai-lab (1차) prompts.py ALLOWED_VALUES/FIELD_SPEC.

2차의 위저드 UI는 visit_purpose/document_type/document_destination/symptom_change/
visit_type을 이미 구조화된 선택지로 받으므로, 1차처럼 자유서술 전체를 LLM이 9개
필드로 추출하지 않는다. 구조화된 선택은 UI 입력을 그대로 신뢰하고, LLM은
subjective_summary/soap_summary 생성에만 사용한다(README 설계 노트 참고).
"""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

VISIT_PURPOSE_OPTIONS = ["약 처방", "증상 상담", "서류 발급", "검사결과 확인"]
SYMPTOM_CHANGE_OPTIONS = ["좋아짐", "비슷함", "나빠짐", "새 증상 있음", "잘 모르겠음"]
DOCUMENT_TYPE_OPTIONS = [
    "진단서",
    "소견서",
    "통원사실증명서(진료확인서)",
    "기록/결과 사본",
    "개인 양식",
    "기타/종류 모름",
]
DOCUMENT_DESTINATION_OPTIONS = ["보험", "직장/학교", "공공기관", "타 의료기관/요양기관", "개인 보관", "제출처 모름"]
DISEASE_CONTEXT_OPTIONS = ["치매", "파킨슨병", "뇌전증"]

VisitType = Literal["patient", "both", "guardian_only"]
VisitPurpose = Literal["약 처방", "증상 상담", "서류 발급", "검사결과 확인"]
SymptomChange = Literal["좋아짐", "비슷함", "나빠짐", "새 증상 있음", "잘 모르겠음"]
DocumentType = Literal["진단서", "소견서", "통원사실증명서(진료확인서)", "기록/결과 사본", "개인 양식", "기타/종류 모름"]
DocumentDestination = Literal["보험", "직장/학교", "공공기관", "타 의료기관/요양기관", "개인 보관", "제출처 모름"]
DiseaseContext = Literal["치매", "파킨슨병", "뇌전증"]

# 공개 API 엔드포인트이므로 위저드가 실제로 보낼 수 있는 값/길이로 엄격히 제한한다.
# (임의 문자열이 그대로 LLM 프롬프트에 들어가거나 DB를 오염시키는 것을 막기 위함)
FREE_TEXT_MAX_LENGTH = 1000


class IntakeSubmission(BaseModel):
    """프론트 위저드(frontend/tablet, /mobile)가 제출하는 그대로의 JSON 형태."""

    disease_context: DiseaseContext
    visit_purpose: list[VisitPurpose] = Field(default_factory=list, max_length=len(VISIT_PURPOSE_OPTIONS))
    symptom_change: SymptomChange | None = None
    requested_consultation: str | None = Field(default=None, max_length=FREE_TEXT_MAX_LENGTH)
    document_type: list[DocumentType] = Field(default_factory=list, max_length=len(DOCUMENT_TYPE_OPTIONS))
    document_destination: list[DocumentDestination] = Field(
        default_factory=list, max_length=len(DOCUMENT_DESTINATION_OPTIONS)
    )
    visit_type: VisitType


class IntakeResponse(BaseModel):
    id: uuid.UUID
    created_at: datetime

    disease_context: str
    visit_purpose: list[str]
    symptom_change: str | None
    document_type: list[str]
    document_destination: list[str]
    patient_present: bool
    guardian_only: bool
    requested_consultation: str | None

    subjective_summary: str
    soap_summary: str

    llm_model: str | None
    fallback_used: bool
    flagged_for_review: bool

    model_config = {"from_attributes": True}


class IntakeListItem(BaseModel):
    id: uuid.UUID
    created_at: datetime
    disease_context: str
    visit_purpose: list[str]
    guardian_only: bool
    flagged_for_review: bool

    model_config = {"from_attributes": True}
