# outpatient-ai-service — 신경과 재진 외래 AI 문진 (2차: 풀스택 확장)

> 1차([outpatient-ai-lab](https://github.com/2heej/OPD-LLM), NLP·프롬프트 평가)를 잇는 프로젝트입니다.
> 1차가 "어떤 프롬프트가 가장 정확하게 문진을 구조화하는가"를 지표로 검증했다면,
> 2차는 그 프롬프트를 실제 동작하는 서비스(위저드 UI → FastAPI → PostgreSQL → 직원용 조회 화면)로
> 완결시키는 데 집중합니다.

신경과(치매·파킨슨병·뇌전증) **재진** 외래 환자가 진료 전에 태블릿/모바일로 문진을 작성하면,
LLM이 자유서술 부분을 요약하고 구조화된 선택 항목과 함께 저장해 의료진이 진료 전에 확인할 수
있게 합니다.

**이 프로젝트가 하지 않는 것** (1차와 동일한 제약을 그대로 유지)
- 실제 환자 개인정보를 사용하지 않습니다 (합성 데이터만).
- 진단·처방·치료 계획을 생성하지 않습니다.
- 실제 응급도/중증도 판단을 하지 않습니다 ("직원 확인 권장" 플래그는 위험 표현 키워드 감지일 뿐입니다).
- 대상은 신경과 재진 환자(치매·파킨슨병·뇌전증)로 한정합니다.

## 아키텍처

```
frontend/tablet, frontend/mobile   →  POST /api/intake         →  FastAPI (backend/)
(정적 위저드 UI, Vercel 배포)                                        │
                                                                      ├─ 구조화 필드는 UI 선택값을 그대로 신뢰
                                                                      ├─ 자유서술만 OpenAI로 요약 (subjective/SOAP)
                                                                      └─ PostgreSQL에 저장 (Render/Supabase)
frontend/dashboard                 →  GET /api/intake(/{id})    →  직원 코드(X-Staff-Code)로 조회
(직원용 조회 화면)
```

### 1차 대비 달라진 설계 (의도적 변경)

1차 `prompts.py`(v3)는 문진 자유서술 전체에서 9개 필드를 LLM이 모두 추출했습니다. 2차는 위저드
UI가 `visit_purpose`/`document_type`/`document_destination`/`symptom_change`/`visit_type`을
이미 구조화된 선택지로 받으므로, **그 값은 UI 입력을 그대로 신뢰**하고 LLM은
`subjective_summary`/`soap_summary` 두 자유서술 필드 생성에만 사용합니다
([backend/app/llm.py](backend/app/llm.py)). 사용자가 명시적으로 선택한 값을 LLM이 재해석해서
뒤집는 위험을 없애기 위한 변경입니다. 또한 1차는 정규식으로 LLM 응답에서 JSON을 추출했지만,
2차는 OpenAI `response_format={"type":"json_schema"}` 구조화 출력을 사용해 파싱 실패 가능성을
줄였습니다.

라이브 공개 데모이므로 OpenAI 호출 비용/남용을 막기 위해 IP당 분당 요청 제한과 일일 LLM 호출
상한을 두고, 상한 초과나 API 실패 시 1차 `legacy_flask/app.py`의 위험 키워드 감지 패턴을 이어받은
규칙 기반 요약으로 자동 대체합니다([backend/app/rate_limit.py](backend/app/rate_limit.py)).

`/api/intake`는 인증 없이 누구나 호출 가능한 공개 엔드포인트이므로, `disease_context` 등
UI가 실제로 보낼 수 있는 값만 Pydantic `Literal` enum으로 제한하고 자유서술 필드에는 길이
제한을 뒀습니다([backend/app/schemas.py](backend/app/schemas.py)) — 위저드를 거치지 않은
임의 입력이 그대로 LLM 프롬프트에 들어가거나 DB를 오염시키는 것을 막기 위함입니다. 위험 표현
감지 결과는 `soap_summary` 텍스트에만 묻어두지 않고 `flagged_for_review` 컬럼으로 별도
저장해 대시보드에서 배지/필터로 바로 보이게 했습니다.

## 저장소 구조

```
backend/         FastAPI + SQLAlchemy(async) + Alembic + PostgreSQL
  app/
    main.py        앱 진입점, CORS, 레이트리밋
    config.py       환경변수
    db.py            비동기 DB 세션
    models.py       Intake ORM 모델
    schemas.py      Pydantic 스키마 (1차 ALLOWED_VALUES/FIELD_SPEC 포팅)
    llm.py            LLM 요약 생성 + 규칙 기반 폴백
    rate_limit.py   레이트리밋 + 일일 LLM 호출 상한
    routers/          intake.py (제출/조회), health.py
  alembic/          DB 마이그레이션
  tests/              pytest (OpenAI 모킹)
frontend/
  tablet/           접수 태블릿용 위저드 (1차 frontend-demo/tablet 포팅)
  mobile/           모바일용 위저드 (1차 frontend-demo/mobile 포팅)
  dashboard/       직원용 접수 현황 조회 화면 (신규)
docker-compose.yml  로컬 PostgreSQL + backend
render.yaml           백엔드 배포 설정 (Render)
frontend/vercel.json  프론트 배포 설정 (Vercel)
```

## 로컬 개발

### 백엔드

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # OPENAI_API_KEY 등 채우기
```

로컬 PostgreSQL 실행 후 마이그레이션 적용:

```bash
docker compose up -d db
cd backend && alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

### 테스트

```bash
cd backend
docker exec <db-container> psql -U opd -d opd -c "CREATE DATABASE opd_test;"  # 최초 1회
pytest
```

pytest는 `USE_LLM_SUMMARY=false`로 기본 실행되어 실제 OpenAI 호출 없이 규칙 기반 경로를
검증합니다. LLM 성공/실패/일일상한 시나리오는 `app.llm.call_llm_summary`를 모킹해 검증합니다
([backend/tests/test_intake.py](backend/tests/test_intake.py)).

### 프론트엔드

`frontend/tablet/index.html`, `/mobile/index.html`의 `window.OPD_API_BASE`를 로컬 백엔드
주소로 맞춘 뒤 정적 서버로 열면 됩니다:

```bash
python3 -m http.server --directory frontend/tablet 8611
python3 -m http.server --directory frontend/mobile 8612
python3 -m http.server --directory frontend/dashboard 8613
```

## 배포

- **DB**: Supabase 무료 PostgreSQL (Render 무료 Postgres는 90일 후 삭제되므로 지속성을 위해 선택)
- **백엔드**: Render 무료 Web Service, `render.yaml` 블루프린트 사용. `DATABASE_URL`,
  `OPENAI_API_KEY`, `STAFF_ACCESS_CODE`, `CORS_ORIGINS`는 Render 대시보드에서 직접 설정
  (`sync: false`로 표시된 값들). 무료 티어는 유휴 시 슬립되어 첫 요청이 느릴 수 있습니다.
- **프론트**: Vercel, 프로젝트 Root Directory를 `frontend`로 설정. 배포 후 `tablet/index.html`,
  `mobile/index.html`, `dashboard/index.html`의 `window.OPD_API_BASE`를 배포된 백엔드 URL로
  교체.

배포 후 확인:

```bash
curl https://<backend-url>/api/health
```

## 알려진 제약과 다음 단계

포트폴리오 데모 범위에서 의도적으로 남겨둔 부분들입니다. 실제 서비스라면 다음이 필요합니다.

- **직원 인증**: 직원 전체가 공유하는 코드 1개(`STAFF_ACCESS_CODE`)로 대시보드를 보호합니다.
  실제로는 개별 계정 + 권한 관리가 필요합니다.
- **레이트리밋 저장소**: `slowapi`의 인메모리 저장소를 사용해 인스턴스 재시작 시 초기화되고,
  다중 인스턴스로 확장하면 인스턴스별로 따로 카운트됩니다. 실제 트래픽 규모라면 Redis 기반
  저장소로 교체해야 합니다.
- **일일 LLM 호출 상한**: UTC 자정 기준이라 한국 시간 자정과는 어긋납니다. 정밀한 리셋 시각이
  중요하다면 타임존을 명시해야 합니다.
- **무료 티어 콜드스타트**: Render 웹 서비스와 Supabase DB 모두 유휴 시 슬립되므로 첫 요청이
  느릴 수 있습니다.
- **`flagged_for_review`는 임상적 판단이 아닙니다**: 키워드 매칭 기반 안전장치일 뿐이며, 실제
  중증도 분류(triage)를 대체하지 않습니다.

## 1차와의 관계

| | 1차 (outpatient-ai-lab) | 2차 (이 저장소) |
|---|---|---|
| 초점 | 프롬프트 엔지니어링, 평가 지표 설계 | 웹 개발, DB, API, 배포 |
| 산출물 | Jupyter 노트북, 정적 UI 프로토타입 | FastAPI 백엔드, PostgreSQL, 실배포 서비스 |
| LLM 역할 | 자유서술 전체에서 9필드 추출 | 자유서술 2필드(S/SOAP)만 요약, 나머지는 UI 신뢰 |
