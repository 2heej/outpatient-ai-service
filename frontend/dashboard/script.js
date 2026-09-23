// 신경과 재진 외래 문진 — 직원용 접수 현황 대시보드
//
// outpatient-ai-lab-v2 백엔드(GET /api/intake, GET /api/intake/{id})를 조회하는
// 정적 클라이언트. STAFF_ACCESS_CODE는 세션 동안만 sessionStorage에 보관하고
// 매 요청마다 X-Staff-Code 헤더로 전송한다(간단한 접근 제어이며 실제 계정 시스템은 아님).

const API_BASE = window.OPD_API_BASE || "http://localhost:8000";
const PAGE_SIZE = 20;

const DISEASE_OPTIONS = ["치매", "파킨슨병", "뇌전증"];

let staffCode = sessionStorage.getItem("opd_staff_code") || "";
let items = [];
let offset = 0;
let hasMore = true;
let listError = null;
let diseaseFilter = "";
let flaggedOnly = false;
let selectedDetail = null;
let detailError = null;

function authHeaders() {
  return { "X-Staff-Code": staffCode };
}

async function login(code) {
  staffCode = code;
  offset = 0;
  items = [];
  listError = null;
  const ok = await loadList();
  if (ok) {
    sessionStorage.setItem("opd_staff_code", staffCode);
  } else {
    staffCode = "";
  }
  render();
}

function logout() {
  staffCode = "";
  sessionStorage.removeItem("opd_staff_code");
  items = [];
  offset = 0;
  render();
}

async function loadList(append = false) {
  try {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    if (diseaseFilter) params.set("disease_context", diseaseFilter);
    if (flaggedOnly) params.set("flagged_only", "true");
    const res = await fetch(`${API_BASE}/api/intake?${params}`, { headers: authHeaders() });
    if (res.status === 401) {
      listError = "직원 코드가 올바르지 않습니다.";
      return false;
    }
    if (!res.ok) throw new Error(`서버 오류 (${res.status})`);
    const data = await res.json();
    items = append ? items.concat(data) : data;
    hasMore = data.length === PAGE_SIZE;
    listError = null;
    return true;
  } catch (err) {
    listError = "목록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.";
    return false;
  }
}

async function loadMore() {
  offset += PAGE_SIZE;
  await loadList(true);
  render();
}

async function openDetail(id) {
  detailError = null;
  selectedDetail = { loading: true };
  render();
  try {
    const res = await fetch(`${API_BASE}/api/intake/${id}`, { headers: authHeaders() });
    if (!res.ok) throw new Error(`서버 오류 (${res.status})`);
    selectedDetail = await res.json();
  } catch (err) {
    selectedDetail = null;
    detailError = "상세 정보를 불러오지 못했습니다.";
  }
  render();
}

function closeDetail() {
  selectedDetail = null;
  detailError = null;
  render();
}

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
}

function gateView() {
  const el = document.createElement("div");
  el.className = "gate";
  el.innerHTML = `
    <h1>직원 로그인</h1>
    <p>접수 현황을 보려면 직원 코드를 입력하세요.</p>
  `;
  if (listError) {
    const err = document.createElement("p");
    err.className = "error-text";
    err.textContent = listError;
    el.appendChild(err);
  }
  const input = document.createElement("input");
  input.type = "password";
  input.placeholder = "직원 코드";
  el.appendChild(input);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-primary";
  btn.textContent = "확인";
  btn.addEventListener("click", () => login(input.value.trim()));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") login(input.value.trim());
  });
  el.appendChild(btn);
  return el;
}

function toolbarView() {
  const bar = document.createElement("div");
  bar.className = "toolbar";

  const select = document.createElement("select");
  select.innerHTML =
    `<option value="">전체 질환군</option>` +
    DISEASE_OPTIONS.map((d) => `<option value="${d}">${d}</option>`).join("");
  select.value = diseaseFilter;
  select.addEventListener("change", async () => {
    diseaseFilter = select.value;
    offset = 0;
    await loadList();
    render();
  });
  bar.appendChild(select);

  const flagLabel = document.createElement("label");
  flagLabel.className = "flag-filter";
  const flagCheckbox = document.createElement("input");
  flagCheckbox.type = "checkbox";
  flagCheckbox.checked = flaggedOnly;
  flagCheckbox.addEventListener("change", async () => {
    flaggedOnly = flagCheckbox.checked;
    offset = 0;
    await loadList();
    render();
  });
  flagLabel.appendChild(flagCheckbox);
  flagLabel.appendChild(document.createTextNode(" 확인 필요만 보기"));
  bar.appendChild(flagLabel);

  const refresh = document.createElement("button");
  refresh.type = "button";
  refresh.className = "btn btn-ghost";
  refresh.textContent = "새로고침";
  refresh.addEventListener("click", async () => {
    offset = 0;
    await loadList();
    render();
  });
  bar.appendChild(refresh);

  const count = document.createElement("span");
  count.className = "count";
  count.textContent = `${items.length}건`;
  bar.appendChild(count);

  return bar;
}

function tableView() {
  const wrap = document.createElement("div");
  wrap.className = "table-wrap";

  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "접수된 문진이 없습니다.";
    wrap.appendChild(empty);
    return wrap;
  }

  const table = document.createElement("table");
  table.innerHTML = `
    <thead>
      <tr>
        <th>접수 시각</th>
        <th>질환군</th>
        <th>방문 목적</th>
        <th>방문 형태</th>
        <th>확인</th>
      </tr>
    </thead>
  `;
  const tbody = document.createElement("tbody");
  items.forEach((item) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${fmtDate(item.created_at)}</td>
      <td>${item.disease_context}</td>
      <td>${item.visit_purpose.join(", ") || "-"}</td>
      <td>${item.guardian_only ? '<span class="badge warn">보호자만</span>' : '<span class="badge">환자 내원</span>'}</td>
      <td>${item.flagged_for_review ? '<span class="badge danger">⚠ 확인 필요</span>' : ""}</td>
    `;
    tr.addEventListener("click", () => openDetail(item.id));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function detailOverlay() {
  if (!selectedDetail) return null;
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeDetail();
  });

  const card = document.createElement("div");
  card.className = "detail-card";

  if (selectedDetail.loading) {
    card.innerHTML = `<p>불러오는 중...</p>`;
  } else {
    const d = selectedDetail;
    card.innerHTML = `
      <h2>${d.disease_context} 문진 상세</h2>
      <p class="meta">${fmtDate(d.created_at)} · ${d.guardian_only ? "보호자만 내원" : "환자 내원"}${
        d.flagged_for_review ? ' · <span class="badge danger">⚠ 확인 필요</span>' : ""
      }</p>
      ${detailRow("방문 목적", d.visit_purpose.join(", ") || "-")}
      ${detailRow("증상 변화", d.symptom_change || "-")}
      ${detailRow("필요 서류", d.document_type.join(", ") || "없음")}
      ${detailRow("제출처", d.document_destination.join(", ") || "-")}
      ${detailRow("상담 요청 내용", d.requested_consultation || "없음")}
      ${detailRow("주관적 요약 (S)", d.subjective_summary)}
      ${detailRow("SOAP 요약", d.soap_summary)}
      ${detailRow("생성 방식", d.fallback_used ? "규칙 기반 폴백" : `LLM (${d.llm_model})`)}
    `;
  }

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "btn btn-ghost detail-close";
  closeBtn.textContent = "닫기";
  closeBtn.addEventListener("click", closeDetail);
  card.appendChild(closeBtn);

  overlay.appendChild(card);
  return overlay;
}

function detailRow(label, value) {
  return `<div class="detail-row"><div class="k">${label}</div><div class="v">${escapeHtml(value)}</div></div>`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function mainView() {
  const el = document.createElement("div");
  el.appendChild(toolbarView());
  if (listError) {
    const err = document.createElement("p");
    err.className = "error-text";
    err.textContent = listError;
    el.appendChild(err);
  }
  el.appendChild(tableView());

  if (hasMore && items.length > 0) {
    const more = document.createElement("button");
    more.type = "button";
    more.className = "btn btn-ghost load-more";
    more.textContent = "더 보기";
    more.addEventListener("click", loadMore);
    el.appendChild(more);
  }
  return el;
}

function render() {
  const main = document.getElementById("main");
  main.innerHTML = "";
  document.getElementById("logout-btn").hidden = !staffCode;

  if (!staffCode) {
    main.appendChild(gateView());
    return;
  }
  main.appendChild(mainView());
  const overlay = detailOverlay();
  if (overlay) main.appendChild(overlay);
}

document.getElementById("logout-btn").addEventListener("click", logout);

if (staffCode) {
  loadList().then(render);
} else {
  render();
}
