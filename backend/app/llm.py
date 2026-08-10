"""LLM summary generation.

1차(outpatient-ai-lab)의 prompts.py v3는 자유서술 전체에서 9개 필드를 모두
추출했다. 2차는 위저드 UI가 visit_purpose/document_type/document_destination/
symptom_change/visit_type을 이미 구조화된 선택지로 받으므로, 그 값들은 UI
입력을 그대로 신뢰하고 LLM은 subjective_summary/soap_summary 두 자유서술
필드만 생성한다 — 사용자가 명시적으로 선택한 값을 LLM이 재해석해 뒤집는
위험을 없애기 위한 의도적 설계 변경.

BASE_PRINCIPLE(진단/치료 방침 생성 금지, 확실하지 않으면 추측 금지)과
RISK_KEYWORDS 기반 "직원 확인 권장" 플래그는 1차 legacy_flask/app.py에서
그대로 이어받는다.
"""

import json
import re

from openai import OpenAI

from app.config import get_settings
from app.schemas import IntakeSubmission

settings = get_settings()

BASE_PRINCIPLE = """
너는 신경과 재진 외래 진료 전 문진 내용을 정리하는 의료 코디네이터다.
진단하거나 치료 방침을 제안하지 않는다.
환자 또는 보호자가 말한 내용을 바탕으로 진료 전 확인에 필요한 정보를 구조화한다.
확실하지 않은 내용은 추측하지 말고 '미상' 또는 원문 표현을 유지한다.
""".strip()

SUMMARY_INSTRUCTIONS = f"""
{BASE_PRINCIPLE}

이 문진은 신경과(치매, 파킨슨병, 뇌전증) 재진 외래 환자를 대상으로 한다.
아래 구조화된 접수 정보와 환자/보호자가 직접 적은 자유서술을 바탕으로
다음 두 필드만 JSON으로 생성한다.

- subjective_summary: 환자 또는 보호자가 말한 내용을 진단·치료 방침 없이 1~2문장으로 구조화한 요약. 보호자만 내원했으면 그 사실을 명시한다.
- soap_summary: 진단·치료 방침을 제외한 S(주관적 정보)/O(해당 없음 명시)/A(진단 생성하지 않음 명시)/P(확인 필요 항목) 형식의 짧은 요약 문자열

입력에 없는 정보는 추정하지 않는다. 반드시 JSON 객체만 출력한다.
""".strip()

RESPONSE_JSON_SCHEMA = {
    "name": "opd_summary",
    "schema": {
        "type": "object",
        "properties": {
            "subjective_summary": {"type": "string"},
            "soap_summary": {"type": "string"},
        },
        "required": ["subjective_summary", "soap_summary"],
        "additionalProperties": False,
    },
    "strict": True,
}

RISK_KEYWORDS = [
    "한쪽 힘",
    "힘이 빠",
    "마비",
    "말이 어눌",
    "말이 안",
    "심한 두통",
    "머리를 부딪",
    "넘어졌",
    "낙상",
    "발작이 5분",
    "반복 발작",
    "숨을 못",
    "호흡",
    "의식",
    "실신",
    "삼키기",
    "사레",
]


def detect_risk(text: str) -> bool:
    return any(keyword in text for keyword in RISK_KEYWORDS)


def _free_text(submission: IntakeSubmission) -> str:
    return " ".join(filter(None, [submission.requested_consultation, submission.raw_input_text])).strip()


def _visit_type_label(submission: IntakeSubmission) -> str:
    return {
        "patient": "환자 본인이 방문",
        "both": "환자와 보호자가 함께 방문",
        "guardian_only": "보호자만 방문",
    }[submission.visit_type]


def build_user_content(submission: IntakeSubmission) -> str:
    lines = [
        f"질환군: {submission.disease_context}",
        f"오늘 방문 목적: {', '.join(submission.visit_purpose) or '미상'}",
        f"증상 변화: {submission.symptom_change or '선택 없음'}",
        f"오늘 방문 형태: {_visit_type_label(submission)}",
    ]
    if submission.document_type:
        lines.append(f"필요 서류: {', '.join(submission.document_type)}")
        lines.append(f"제출처: {', '.join(submission.document_destination) or '미상'}")
    free_text = _free_text(submission)
    lines.append(f"환자/보호자가 직접 적은 내용: {free_text or '없음'}")
    return "\n".join(lines)


def rule_based_summary(submission: IntakeSubmission, patient_present: bool, guardian_only: bool) -> tuple[str, str]:
    """OpenAI 호출을 사용할 수 없을 때(일일 상한 초과, API 실패 등) 적용하는 규칙 기반 대체."""
    free_text = _free_text(submission)

    subjective_parts = [f"오늘 방문 목적: {', '.join(submission.visit_purpose) or '미상'}"]
    if guardian_only:
        subjective_parts.append("보호자만 내원, 환자는 오늘 진료에 참석하지 않음")
    if submission.symptom_change:
        subjective_parts.append(f"증상 변화: {submission.symptom_change}")
    if free_text:
        subjective_parts.append(f"환자/보호자 원문: {free_text}")
    subjective_summary = ". ".join(subjective_parts) + "."

    plan_items = []
    if submission.document_type:
        plan_items.append(f"서류 종류·제출처 확인: {', '.join(submission.document_type)}")
    if submission.symptom_change in ("나빠짐", "새 증상 있음"):
        plan_items.append("증상 변화 진행 양상 확인")
    if detect_risk(free_text):
        plan_items.insert(0, "위험 표현 감지: 직원 확인 권장")
    if not plan_items:
        plan_items.append("특이 확인 필요 항목 없음")

    soap_summary = (
        f"S: {subjective_summary} "
        "O: 해당 없음(문진 입력만으로 진찰 소견 생성하지 않음). "
        "A: 진단/치료 방침 생성하지 않음. "
        f"P: {', '.join(plan_items)}."
    )
    return subjective_summary, soap_summary


def parse_json_object(raw_text: str) -> dict:
    cleaned = raw_text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?", "", cleaned).strip()
        cleaned = re.sub(r"```$", "", cleaned).strip()
    match = re.search(r"\{.*\}", cleaned, flags=re.DOTALL)
    if not match:
        raise ValueError("LLM 응답에서 JSON 객체를 찾지 못했습니다.")
    return json.loads(match.group(0))


def call_llm_summary(submission: IntakeSubmission) -> tuple[str, str]:
    """실패 시 예외를 던진다 — 호출부(generate_summary)에서 규칙 기반으로 대체한다."""
    client = OpenAI(api_key=settings.openai_api_key)
    completion = client.chat.completions.create(
        model=settings.openai_model,
        messages=[
            {"role": "system", "content": SUMMARY_INSTRUCTIONS},
            {"role": "user", "content": build_user_content(submission)},
        ],
        response_format={"type": "json_schema", "json_schema": RESPONSE_JSON_SCHEMA},
    )
    payload = parse_json_object(completion.choices[0].message.content or "")
    return str(payload["subjective_summary"]), str(payload["soap_summary"])


def generate_summary(
    submission: IntakeSubmission, patient_present: bool, guardian_only: bool, allow_llm: bool
) -> tuple[str, str, str | None, bool]:
    """Returns (subjective_summary, soap_summary, llm_model_or_None, fallback_used)."""
    if allow_llm and settings.use_llm_summary and settings.openai_api_key:
        try:
            subjective, soap = call_llm_summary(submission)
            free_text = _free_text(submission)
            if detect_risk(free_text) and "위험 표현" not in soap:
                soap = soap.rstrip(". ") + ". 위험 표현 감지: 직원 확인 권장."
            return subjective, soap, settings.openai_model, False
        except Exception as error:  # noqa: BLE001 — LLM 실패는 폴백으로 흡수
            print(f"[LLM fallback] {error}")

    subjective, soap = rule_based_summary(submission, patient_present, guardian_only)
    return subjective, soap, None, True
