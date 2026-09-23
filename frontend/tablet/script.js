// 신경과 재진 외래 문진 — 접수 태블릿용 실사용 데모
//
// outpatient-ai-lab(1차)의 정적 프로토타입을 포팅해 실제 FastAPI 백엔드
// (POST /api/intake)에 연결한 버전이다. 화면 전환·검증 로직은 1차와 동일하며,
// "접수하기" 단계에서만 서버로 제출하고 LLM이 생성한 요약을 돌려받는다.

const API_BASE = window.OPD_API_BASE || "http://localhost:8000";

const answers = {
  disease_context: "치매", // 예약 정보 연동을 가정한 자동 표시값(데모 고정값)
  visit_purpose: [],
  symptom_change: null,
  requested_consultation: "",
  document_type: [],
  document_destination: [],
  visit_type: null,
};

let submitting = false;
let submitError = null;
let serverResult = null;

function buildPayload() {
  return {
    disease_context: answers.disease_context,
    visit_purpose: answers.visit_purpose,
    symptom_change: answers.symptom_change,
    requested_consultation: answers.requested_consultation || null,
    document_type: answers.document_type,
    document_destination: answers.document_destination,
    visit_type: answers.visit_type,
  };
}

async function submitIntake() {
  submitting = true;
  submitError = null;
  render();
  try {
    const res = await fetch(`${API_BASE}/api/intake`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildPayload()),
    });
    if (!res.ok) throw new Error(`서버 오류 (${res.status})`);
    serverResult = await res.json();
    submitting = false;
    goTo("done");
  } catch (err) {
    submitting = false;
    submitError = "접수 중 문제가 발생했어요. 잠시 후 다시 시도해주세요.";
    render();
  }
}

const PURPOSE_OPTIONS = [
  { value: "약 처방", icon: "💊", sub: "먹던 약을 계속 받고 싶어요" },
  { value: "증상 상담", icon: "🩺", sub: "달라진 증상을 여쭤보고 싶어요" },
  { value: "서류 발급", icon: "📄", sub: "제출할 서류가 필요해요" },
  { value: "검사결과 확인", icon: "🔬", sub: "지난 검사 결과가 궁금해요" },
];

const SYMPTOM_OPTIONS = [
  { value: "좋아짐", icon: "🙂", sub: "전보다 편해지셨어요" },
  { value: "비슷함", icon: "😐", sub: "지난번과 비슷해요" },
  { value: "나빠짐", icon: "😟", sub: "전보다 심해지셨어요" },
  { value: "새 증상 있음", icon: "❗", sub: "전에 없던 증상이 생겼어요" },
  { value: "잘 모르겠음", icon: "❓", sub: "판단하기 어려워요" },
];

const DOCUMENT_TYPE_OPTIONS = [
  "진단서",
  "소견서",
  "통원사실증명서(진료확인서)",
  "기록/결과 사본",
  "개인 양식",
  "기타/종류 모름",
];

const DOCUMENT_DEST_OPTIONS = ["보험", "직장/학교", "공공기관", "타 의료기관/요양기관", "개인 보관", "제출처 모름"];

const VISIT_TYPE_OPTIONS = [
  { value: "patient", icon: "🧍", label: "환자 본인이 오셨어요" },
  { value: "both", icon: "🧑‍🤝‍🧑", label: "환자와 보호자가 함께 오셨어요" },
  { value: "guardian_only", icon: "🧑‍🦽", label: "보호자만 오셨어요" },
];

function needsSymptomScreen() {
  return answers.visit_purpose.includes("약 처방") || answers.visit_purpose.includes("증상 상담");
}
function needsConsultScreen() {
  return answers.visit_purpose.includes("증상 상담");
}
function needsDocumentScreen() {
  return answers.visit_purpose.includes("서류 발급");
}

const stepOrder = [
  "welcome",
  "purpose",
  "symptom",
  "consult",
  "document",
  "visitType",
  "review",
  "done",
];

function visibleSteps() {
  return stepOrder.filter((id) => {
    if (id === "symptom") return needsSymptomScreen();
    if (id === "consult") return needsConsultScreen();
    if (id === "document") return needsDocumentScreen();
    return true;
  });
}

let currentId = "welcome";

function toggleInArray(arr, value) {
  const i = arr.indexOf(value);
  if (i >= 0) arr.splice(i, 1);
  else arr.push(value);
}

function goTo(id) {
  currentId = id;
  render();
}

function goNext() {
  const steps = visibleSteps();
  const i = steps.indexOf(currentId);
  if (i < steps.length - 1) goTo(steps[i + 1]);
}

function goBack() {
  const steps = visibleSteps();
  const i = steps.indexOf(currentId);
  if (i > 0) goTo(steps[i - 1]);
}

function canProceed() {
  switch (currentId) {
    case "purpose":
      return answers.visit_purpose.length > 0;
    case "symptom":
      return Boolean(answers.symptom_change);
    case "visitType":
      return Boolean(answers.visit_type);
    case "review":
      return !submitting;
    default:
      return true;
  }
}

function renderProgressDots() {
  const steps = visibleSteps().filter((s) => s !== "welcome" && s !== "done");
  const dots = document.getElementById("progress-dots");
  if (currentId === "welcome" || currentId === "done") {
    dots.innerHTML = "";
    return;
  }
  const currentPos = steps.indexOf(currentId);
  dots.innerHTML = steps
    .map((_, idx) => {
      const cls = idx === currentPos ? "active" : idx < currentPos ? "done" : "";
      return `<span class="${cls}"></span>`;
    })
    .join("");
}

function choiceCard({ selected, icon, label, sub, onClick }) {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "choice-card" + (selected ? " selected" : "");
  el.innerHTML = `${icon ? `<span class="icon">${icon}</span>` : ""}<span>${label}${
    sub ? `<span class="label-sub">${sub}</span>` : ""
  }</span>`;
  el.addEventListener("click", onClick);
  return el;
}

function navRow(container, { backLabel = "이전", nextLabel = "다음", onNext, hideBack = false } = {}) {
  const row = document.createElement("div");
  row.className = "nav-row";

  if (!hideBack) {
    const back = document.createElement("button");
    back.type = "button";
    back.className = "btn btn-ghost";
    back.textContent = backLabel;
    back.addEventListener("click", goBack);
    row.appendChild(back);
  } else {
    row.appendChild(document.createElement("span"));
  }

  const next = document.createElement("button");
  next.type = "button";
  next.className = "btn btn-primary";
  next.textContent = nextLabel;
  next.disabled = !canProceed();
  next.addEventListener("click", onNext || goNext);
  row.appendChild(next);

  container.appendChild(row);
}

function screens() {
  return {
    welcome() {
      const s = document.createElement("div");
      s.className = "screen center";
      s.innerHTML = `
        <p class="eyebrow">신경과 재진 문진</p>
        <h1 class="big">안녕하세요.<br />진료 전에 몇 가지만 여쭤볼게요.</h1>
        <p class="helper">화면을 눌러 답해주세요. 어려우시면 접수 직원에게 말씀해주세요.</p>
      `;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-primary btn-start";
      btn.textContent = "시작하기";
      btn.addEventListener("click", goNext);
      s.appendChild(btn);
      return s;
    },

    purpose() {
      const s = document.createElement("div");
      s.className = "screen";
      s.innerHTML = `
        <p class="eyebrow">${answers.disease_context} 진료</p>
        <h1>오늘은 무엇 때문에 오셨어요?</h1>
        <p class="helper">해당하는 것을 모두 눌러주세요.</p>
      `;
      const grid = document.createElement("div");
      grid.className = "choice-grid";
      PURPOSE_OPTIONS.forEach((opt) => {
        grid.appendChild(
          choiceCard({
            selected: answers.visit_purpose.includes(opt.value),
            icon: opt.icon,
            label: opt.value,
            sub: opt.sub,
            onClick: () => {
              toggleInArray(answers.visit_purpose, opt.value);
              render();
            },
          })
        );
      });
      s.appendChild(grid);
      navRow(s, { hideBack: true });
      return s;
    },

    symptom() {
      const s = document.createElement("div");
      s.className = "screen";
      s.innerHTML = `
        <p class="eyebrow">증상 변화</p>
        <h1>요즘 증상은 어떠세요?</h1>
        <p class="helper">지난 진료 때와 비교해서 골라주세요.</p>
      `;
      const grid = document.createElement("div");
      grid.className = "choice-grid cols-1";
      SYMPTOM_OPTIONS.forEach((opt) => {
        grid.appendChild(
          choiceCard({
            selected: answers.symptom_change === opt.value,
            icon: opt.icon,
            label: opt.value,
            sub: opt.sub,
            onClick: () => {
              answers.symptom_change = opt.value;
              render();
            },
          })
        );
      });
      s.appendChild(grid);
      navRow(s);
      return s;
    },

    consult() {
      const s = document.createElement("div");
      s.className = "screen";
      s.innerHTML = `
        <p class="eyebrow">상담하고 싶은 내용</p>
        <h1>오늘 여쭤보고 싶은 것을 편하게 적어주세요.</h1>
        <p class="helper">적지 않으셔도 괜찮아요. 진료 중에 다시 여쭤봐요.</p>
      `;
      const field = document.createElement("div");
      field.className = "field-block";
      const ta = document.createElement("textarea");
      ta.className = "big-input";
      ta.placeholder = "예: 요즘 손 떨림이 오후에 더 심해지는 것 같아요.";
      ta.value = answers.requested_consultation;
      ta.addEventListener("input", () => {
        answers.requested_consultation = ta.value;
      });
      field.appendChild(ta);
      s.appendChild(field);
      navRow(s);
      return s;
    },

    document() {
      const s = document.createElement("div");
      s.className = "screen";
      s.innerHTML = `
        <p class="eyebrow">서류 안내</p>
        <h1>어떤 서류가 필요하세요?</h1>
        <p class="helper">서류 이름을 잘 모르셔도 괜찮아요, '기타/종류 모름'을 눌러주세요.</p>
      `;

      const typeBlock = document.createElement("div");
      typeBlock.className = "field-block";
      typeBlock.innerHTML = `<span class="field-title">필요한 서류</span>`;
      const typeGrid = document.createElement("div");
      typeGrid.className = "choice-grid";
      DOCUMENT_TYPE_OPTIONS.forEach((val) => {
        typeGrid.appendChild(
          choiceCard({
            selected: answers.document_type.includes(val),
            label: val,
            onClick: () => {
              toggleInArray(answers.document_type, val);
              render();
            },
          })
        );
      });
      typeBlock.appendChild(typeGrid);

      const destBlock = document.createElement("div");
      destBlock.className = "field-block";
      destBlock.innerHTML = `<span class="field-title">어디에 제출하시나요?</span>`;
      const destGrid = document.createElement("div");
      destGrid.className = "choice-grid";
      DOCUMENT_DEST_OPTIONS.forEach((val) => {
        destGrid.appendChild(
          choiceCard({
            selected: answers.document_destination.includes(val),
            label: val,
            onClick: () => {
              toggleInArray(answers.document_destination, val);
              render();
            },
          })
        );
      });
      destBlock.appendChild(destGrid);

      s.appendChild(typeBlock);
      s.appendChild(destBlock);
      navRow(s);
      return s;
    },

    visitType() {
      const s = document.createElement("div");
      s.className = "screen";
      s.innerHTML = `
        <p class="eyebrow">오늘 방문</p>
        <h1>오늘은 누구와 함께 오셨어요?</h1>
      `;
      const grid = document.createElement("div");
      grid.className = "choice-grid cols-1";
      VISIT_TYPE_OPTIONS.forEach((opt) => {
        grid.appendChild(
          choiceCard({
            selected: answers.visit_type === opt.value,
            icon: opt.icon,
            label: opt.label,
            onClick: () => {
              answers.visit_type = opt.value;
              render();
            },
          })
        );
      });
      s.appendChild(grid);
      navRow(s, { nextLabel: "확인하기" });
      return s;
    },

    review() {
      const s = document.createElement("div");
      s.className = "screen";
      s.innerHTML = `
        <p class="eyebrow">마지막 확인</p>
        <h1>이렇게 접수할게요.</h1>
      `;
      const list = document.createElement("div");
      list.className = "summary-list";

      const rows = [
        ["오늘 목적", answers.visit_purpose.join(", ") || "-"],
      ];
      if (needsSymptomScreen()) rows.push(["증상 변화", answers.symptom_change || "-"]);
      if (needsConsultScreen() && answers.requested_consultation) {
        rows.push(["상담 내용", answers.requested_consultation]);
      }
      if (needsDocumentScreen()) {
        rows.push(["필요 서류", answers.document_type.join(", ") || "-"]);
        rows.push(["제출처", answers.document_destination.join(", ") || "-"]);
      }
      const visitLabel = VISIT_TYPE_OPTIONS.find((o) => o.value === answers.visit_type)?.label || "-";
      rows.push(["오늘 방문", visitLabel]);

      rows.forEach(([k, v]) => {
        const row = document.createElement("div");
        row.className = "summary-row";
        row.innerHTML = `<span class="k">${k}</span><span class="v">${v}</span>`;
        list.appendChild(row);
      });
      s.appendChild(list);
      if (submitError) {
        const err = document.createElement("p");
        err.className = "helper error-text";
        err.textContent = submitError;
        s.appendChild(err);
      }
      navRow(s, { nextLabel: submitting ? "접수 중..." : "접수하기", onNext: submitIntake });
      return s;
    },

    done() {
      const s = document.createElement("div");
      s.className = "screen center";
      s.innerHTML = `
        <span class="done-icon">✅</span>
        <h1>문진이 접수되었습니다.</h1>
        <p class="helper">잠시만 기다려 주시면 진료실에서 다시 편하게 말씀해주세요.</p>
      `;

      const toggle = document.createElement("details");
      toggle.className = "dev-toggle";
      toggle.innerHTML = `<summary>(개발자용) 이 데이터가 어떻게 구조화되는지 보기</summary>`;
      const pre = document.createElement("pre");
      pre.textContent = JSON.stringify({ submitted: answers, server_response: serverResult }, null, 2);
      toggle.appendChild(pre);
      s.appendChild(toggle);
      return s;
    },
  };
}

function render() {
  renderProgressDots();
  const stage = document.getElementById("stage");
  stage.innerHTML = "";
  stage.appendChild(screens()[currentId]());
}

render();
