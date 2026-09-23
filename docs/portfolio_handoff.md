# outpatient-ai-service — 포트폴리오 작성용 정리 (2026-09-23)

이 문서는 다른 세션/도구(예: Codex)에 넘겨서 포트폴리오 글을 쓸 때 참고할 수 있도록,
이 대화에서 쌓인 맥락을 자체 완결형으로 정리한 것입니다. 코드/커밋 히스토리를 다시 읽지
않고도 이 문서 하나로 프로젝트의 배경·결정·결과를 파악할 수 있게 썼습니다.

## 한 줄 요약

신경과 재진 외래 AI 문진 프로젝트를 1차(NLP·프롬프트 평가, 노트북 중심)에서 2차(FastAPI +
PostgreSQL + 실배포 풀스택 서비스)로 확장한 프로젝트. 지원자는 간호사 출신으로 AI 헬스케어
PM 전직을 준비 중이며, 1차가 "프롬프트 설계·평가 역량"을 보여줬다면 2차는 "그걸 실제
서비스로 완결시키는 엔지니어링·제품 역량"을 보여주는 게 목적.

## 링크

- 2차 저장소: https://github.com/2heej/outpatient-ai-service
- 1차 저장소: https://github.com/2heej/OPD-LLM
- 라이브 데모(태블릿): https://outpatient-ai-service.vercel.app/tablet/
- 라이브 데모(모바일): https://outpatient-ai-service.vercel.app/mobile/
- 라이브 데모(직원 대시보드): https://outpatient-ai-service.vercel.app/dashboard/ (코드: `board`)
- 백엔드 헬스체크: https://outpatient-ai-service.onrender.com/api/health

## 왜 이 확장을 했는가

1차는 "Flask/DB/API/배포는 범위 밖"이라고 명시적으로 스코프를 좁혀뒀던 프로젝트였다.
채용 담당자에게 (1) 실제 서비스로 완결시키는 능력, (2) PM 관점의 요구사항→설계 능력,
(3) 풀스택 개발 역량 자체를 보여주기 위해 이 스코프 결정을 뒤집고 2차를 시작했다.

## 문제 정의 (1차와 동일, 재진술)

신경과 재진 외래에서: 환자/보호자가 미리 전달한 정보가 진료 중 다시 확인되며 시간 소요,
서류 종류/제출처가 불명확한 채 접수돼 발급 지연, 보호자 단독 내원이 사전에 파악 안 됨,
상담 요청 내용이 접수 단계에서 기록 안 됨. 대상은 신경과(치매·파킨슨병·뇌전증) 재진
환자로 한정. 진단/처방/치료계획/실제 응급도 판단은 절대 하지 않는다는 원칙은 1차부터
일관되게 유지.

## 아키텍처

```
환자/보호자 → 태블릿 또는 모바일 위저드 (정적 HTML/JS, Vercel 배포)
                → POST /api/intake → FastAPI (Render 배포, Docker)
                                        ├─ 구조화 필드(방문목적/증상변화/서류종류 등)는
                                        │   위저드 선택값을 그대로 신뢰
                                        ├─ 자유서술 2필드(주관적 요약/SOAP 요약)만
                                        │   OpenAI로 생성 (gpt-4.1-mini,
                                        │   response_format=json_schema)
                                        └─ PostgreSQL(Supabase)에 저장
직원 → 대시보드 (Vercel) → GET /api/intake(/{id}) → X-Staff-Code 헤더로 인증
```

## 핵심 설계 결정 (인터뷰에서 "왜 이렇게 했나" 질문에 쓸 내용)

1. **LLM의 역할을 의도적으로 축소했다.** 1차 프롬프트 v3는 자유서술 전체에서 9개 필드를
   전부 추출했다. 2차는 위저드 UI가 방문목적/증상변화/서류종류/서류제출처/방문형태를
   이미 구조화된 선택지로 받으므로, 그 값은 UI 입력을 그대로 신뢰하고 LLM은 주관적
   요약(S)과 SOAP 요약 두 개만 생성한다. **이유**: 사용자가 명시적으로 고른 값을 LLM이
   자유서술을 재해석해서 뒤집어버리는 위험을 원천 차단하기 위함. "LLM을 더 많이 쓰는 게
   더 좋은 설계가 아니다"라는 걸 보여주는 결정.
2. **1차보다 견고한 LLM 출력 방식으로 개선.** 1차는 정규식으로 LLM 응답에서 JSON을
   추출했지만(파싱 실패 가능), 2차는 OpenAI `response_format={"type":"json_schema"}`
   구조화 출력을 사용해 파싱 실패 가능성을 줄였다.
3. **공개 API에 대한 입력 검증 강화.** `/api/intake`는 인증 없이 누구나 호출 가능한
   퍼블릭 엔드포인트다. 처음엔 `disease_context` 등이 임의 문자열을 허용했는데, 이는
   위저드를 거치지 않은 임의 입력이 그대로 LLM 프롬프트에 들어가거나 DB를 오염시킬 수
   있는 문제였다. Pydantic `Literal` enum으로 위저드가 실제로 보낼 수 있는 값만 허용하고,
   자유서술에는 길이 제한을 뒀다.
4. **비용/남용 방어.** 라이브 공개 데모라 OpenAI 호출 비용이 실제 문제가 된다. IP당 분당
   요청 제한 + 일일 LLM 호출 상한을 두고, 상한 초과나 API 실패 시 1차 `legacy_flask/app.py`의
   위험 키워드 감지 패턴을 이어받은 규칙 기반 요약으로 자동 대체(fallback)한다.
5. **위험 신호를 텍스트에 묻어두지 않고 구조화했다.** 위험 표현(낙상, 마비, 의식 저하 등
   키워드 매칭) 감지 결과를 `soap_summary` 텍스트 안에만 남기지 않고, 별도
   `flagged_for_review` 컬럼으로 저장해 대시보드에서 배지/필터로 바로 보이게 했다.
   실무자가 레코드를 하나씩 열어보지 않고도 확인 필요 건을 한눈에 볼 수 있게 한 제품
   결정. (단, 이건 임상적 triage가 아니라 키워드 기반 안전장치라는 점을 README에 명시.)

## 기술 스택

- 백엔드: FastAPI, SQLAlchemy 2.0(async) + asyncpg, Alembic, slowapi(rate limiting)
- DB: PostgreSQL (Supabase, Session pooler로 연결 — 아래 트러블슈팅 참고)
- LLM: OpenAI gpt-4.1-mini, structured output
- 프론트: Vanilla HTML/CSS/JS (프레임워크 없음), 태블릿/모바일/대시보드 3개 화면
- 배포: 백엔드 Render(Docker), DB Supabase, 프론트 Vercel
- 테스트: pytest + pytest-asyncio, OpenAI 모킹, 15개 테스트 전체 통과
- CI 없음 (포트폴리오 규모, 수동 검증)

## 실제 겪은 트러블슈팅 (신입 개발자다운 "삽질 극복" 서사로 쓰기 좋음)

배포 과정에서 실제로 순서대로 겪은 문제들 — 이런 디버깅 경험 자체가 "실제 배포까지
해봤다"는 증거이자 이야기거리가 된다:

1. Docker 빌드 시 `COPY requirements.txt` 실패 → Render의 "Docker Build Context
   Directory"가 저장소 루트로 잡혀 있어서 `backend/` 하위 파일을 못 찾음. Build Context를
   `backend`로 지정해 해결.
2. `ModuleNotFoundError: No module named 'psycopg2'` → `DATABASE_URL`에 `+asyncpg`
   드라이버 지정이 빠져서 SQLAlchemy가 기본 동기 드라이버(psycopg2)를 쓰려 함.
3. `OSError: Network is unreachable` → Supabase의 "Direct connection"은 IPv6 주소를
   쓰는데 Render 무료 티어는 아웃바운드 IPv6를 지원하지 않음. Supabase의 "Session
   pooler"(IPv4 지원)로 전환해 해결 — Supabase+Render 조합에서 꽤 알려진 호환성 이슈.
4. `InvalidPasswordError` → 연결 문자열에서 `[YOUR-PASSWORD]` 플레이스홀더를 실제
   비밀번호로 바꾸면서 대괄호 `[` `]`까지 문자 그대로 남겨서 비밀번호 자체가 틀어짐.
   로컬에서 asyncpg로 직접 연결 테스트하는 스크립트를 돌려서 원인을 빠르게 특정.
5. Vercel 배포 후 프론트가 스타일 없이(CSS/JS 미적용) 렌더링됨 → `vercel.json`의
   `trailingSlash: false` 설정 때문에 `/tablet`(트레일링 슬래시 없음) 접속 시 상대경로
   `style.css`/`script.js`가 사이트 루트 기준으로 잘못 풀려 404. `trailingSlash: true`로
   수정해 해결.

## 검증 완료 사항

- 로컬: docker-compose로 Postgres 띄우고 Alembic 마이그레이션 적용, pytest 15개 전체
  통과(성공/실패/일일상한 초과 시 폴백 경로 포함), 실제 OpenAI 호출로 브라우저
  end-to-end 검증(태블릿·모바일 위저드 → 백엔드 → DB 저장 → 대시보드 조회).
- 라이브: 배포된 Vercel 프론트에서 실제 제출 2건 성공(일반 케이스 1건, 보호자 단독+서류
  발급 케이스 1건), Render 백엔드 → Supabase DB → OpenAI 응답까지 실제 왕복 확인, 직원
  대시보드 로그인·목록·상세·필터 전부 라이브에서 동작 확인.

## 알려진 한계 (README에도 명시되어 있음, 정직하게 쓸 것)

- 직원 인증이 개별 계정이 아니라 공유 코드 1개(`board`)다.
- 레이트리밋이 인메모리라 인스턴스 재시작 시 초기화되고, 다중 인스턴스로 확장 시
  인스턴스별로 따로 카운트된다(실 서비스라면 Redis로 교체 필요).
- 일일 LLM 호출 상한이 UTC 자정 기준이라 한국 시간 자정과 어긋난다.
- Render/Supabase 무료 티어는 유휴 시 슬립되어 첫 요청이 느릴 수 있다.
- `flagged_for_review`는 키워드 매칭 기반 안전장치일 뿐 임상적 triage가 아니다.

## 1차와 2차 비교표 (README에서 그대로 가져옴)

| | 1차 (outpatient-ai-lab) | 2차 (outpatient-ai-service) |
|---|---|---|
| 초점 | 프롬프트 엔지니어링, 평가 지표 설계 | 웹 개발, DB, API, 배포 |
| 산출물 | Jupyter 노트북, 정적 UI 프로토타입 | FastAPI 백엔드, PostgreSQL, 실배포 서비스 |
| LLM 역할 | 자유서술 전체에서 9필드 추출 | 자유서술 2필드(S/SOAP)만 요약, 나머지는 UI 신뢰 |

## 포트폴리오 작성 시 제안하는 스토리라인

1. **"Flask는 범위 밖"이라던 1차의 스코프 결정을 왜, 어떻게 뒤집었는가** — 의도적 스코프
   축소와 확장 둘 다 판단해본 경험.
2. **LLM을 덜 쓰는 게 더 나은 설계였다** — 9필드 추출(1차) → 2필드 요약(2차)로 축소한
   결정과 그 이유. "AI를 무조건 많이 쓰는 게 아니라 UI가 이미 아는 걸 UI가 처리하게
   한다"는 제품 감각.
3. **트러블슈팅 서사** — 위 5가지 배포 이슈를 순서대로 겪고 해결한 과정 (특히 IPv6/풀러
   이슈와 trailingSlash 이슈는 실무에서도 자주 나오는 종류의 문제라 설득력 있음).
4. **안전장치를 UI까지 끌고 온 결정** — flagged_for_review를 텍스트에 묻지 않고 컬럼화해
   대시보드에 노출한 것. "데이터는 있는데 안 보이면 없는 것과 같다"는 감각.
5. **간호사 → PM 서사와의 연결**: 임상 워크플로를 이해하는 사람이 "확인 필요 항목을
   놓치면 안 된다"는 감각으로 flagged_for_review 같은 디테일을 챙긴 것.
