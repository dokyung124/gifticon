/* 기프티콘함 — 앱 코드
   Supabase 프로젝트 주소와 공개 키 (공개돼도 괜찮은 값이에요) */
const SUPABASE_URL = "https://rjyngzgzkjqelwkrcmws.supabase.co";
const SUPABASE_KEY = "sb_publishable_9YGuoMij_MUNkEN4mO4YEw_Y0Snp6jF";
const VAPID_PUBLIC_KEY = "BNmmHNe81o8HEYpfXGHgFqebA7DeGYEZA3fRKdUGIm57_dcn4mYyvmfZvu0KoWQMfFcOH9nqBL1444EL5hhx6lU";
const BUCKET = "gifticon-images";
const INGEST_URL = SUPABASE_URL + "/functions/v1/gifticon-ingest";
const SHORTCUT_NAME = "기프티콘 불러오기"; // 단축어 이름과 똑같아야 해요
const ZXING_URL = "https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js";
const TESSERACT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";

// ---- 캡쳐 글자에서 정보 뽑기 (앱과 서버가 같은 코드를 씀) ----
function gcNormalizeBarcode(v) {
  return String(v || "").replace(/[\s-]/g, "");
}

function gcIsUsedText(text) {
  const t = String(text || "").replace(/\s+/g, "");
  // "사용 완료하기" 같은 버튼 글자는 사용한 게 아니라서 빼요
  const cleaned = t.replace(/사용완료(하기|처리하기|버튼|로표시)/g, "");
  return /사용완료|사용이완료|사용처리완료|이미사용(된|한|되)/.test(cleaned);
}

function gcValidDate(y, m, d) {
  if (y < 2020 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function gcFindDates(text) {
  const out = [];
  const re = /(20\d{2})\s*(?:[.\-\/]|년)\s*(\d{1,2})\s*(?:[.\-\/]|월)\s*(\d{1,2})/g;
  let m;
  while ((m = re.exec(text))) {
    const v = gcValidDate(+m[1], +m[2], +m[3]);
    if (v) out.push({ value: v, index: m.index });
  }
  return out;
}

function gcParseExpiry(text) {
  const t = String(text || "");
  const dates = gcFindDates(t);
  if (!dates.length) return null;
  const kw = /유\s*효\s*기\s*간|사\s*용\s*기\s*한|만\s*료\s*일|까\s*지/g;
  const near = [];
  let k;
  while ((k = kw.exec(t))) {
    for (const d of dates) {
      if (Math.abs(d.index - k.index) <= 45) near.push(d.value);
    }
  }
  const pool = near.length ? near : dates.map((d) => d.value);
  return pool.sort().pop();
}

function gcBarcodeCandidates(text) {
  const lines = String(text || "").split(/\r?\n/);
  const scored = [];
  for (const line of lines) {
    if (/주\s*문\s*번\s*호|전\s*화|고\s*객\s*센\s*터|문\s*의|사\s*업\s*자|승\s*인/.test(line)) continue;
    const re = /\d[\d \-]{8,30}\d/g;
    let m;
    while ((m = re.exec(line))) {
      const digits = m[0].replace(/\D/g, "");
      if (digits.length < 10 || digits.length > 20) continue;
      if (/^01[016789]\d{7,8}$/.test(digits)) continue; // 휴대폰 번호
      if (/^20\d{6}$/.test(digits)) continue;
      const lineDigits = line.replace(/\D/g, "").length;
      const lineLen = line.replace(/\s/g, "").length || 1;
      const score = digits.length + (lineDigits / lineLen > 0.8 ? 10 : 0);
      scored.push({ digits, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return [...new Set(scored.map((s) => s.digits))];
}

const GC_BRANDS = [
  "GS25", "CU", "세븐일레븐", "이마트24", "미니스톱", "스타벅스", "투썸플레이스", "메가커피", "메가MGC커피", "컴포즈커피",
  "빽다방", "이디야", "할리스", "폴바셋", "커피빈", "엔제리너스", "탐앤탐스", "파스쿠찌", "공차", "설빙",
  "배스킨라빈스", "던킨", "파리바게뜨", "뚜레쥬르", "크리스피크림", "BHC", "BBQ", "교촌치킨", "굽네치킨", "처갓집",
  "푸라닭", "노랑통닭", "맘스터치", "버거킹", "맥도날드", "롯데리아", "KFC", "서브웨이", "도미노피자", "피자헛",
  "파파존스", "미스터피자", "아웃백", "빕스", "올리브영", "다이소", "이마트", "홈플러스", "롯데마트", "노브랜드",
  "배달의민족", "요기요", "쿠팡이츠", "CGV", "메가박스", "롯데시네마", "교보문고", "아트박스", "본죽", "명랑핫도그",
];

const GC_LABEL = /^(사\s*용\s*처|교\s*환\s*처|사\s*용\s*기\s*간|사\s*용\s*조\s*건|유\s*효\s*기\s*간|유\s*효\s*기\s*한|사\s*용\s*기\s*한|이\s*용\s*기\s*간|쿠\s*폰\s*명|상\s*품\s*명|주\s*문\s*번\s*호|쿠\s*폰\s*번\s*호|유\s*의\s*사\s*항|만\s*료\s*일)\s*[:：]?$/;
const GC_JUNK_VALUE = /유의사항|참고|상세|매장|온라인|전국|사용가능/;

function gcLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

// "라벨 값"이 한 줄에 있거나, 라벨 다음 줄에 값이 있을 때 값 꺼내기
function gcLabelValue(lines, labelRe) {
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(new RegExp("^(?:" + labelRe + ")[ \\t]*[:：]?[ \\t]*(.*)$"));
    if (!m) continue;
    if (m[1] && !GC_LABEL.test(m[1])) return m[1].trim();
    const next = lines[i + 1];
    if (next && !GC_LABEL.test(next) && !/^\d[\d.\-~ ]+$/.test(next)) return next;
  }
  return "";
}

function gcKnownBrand(text) {
  const t = String(text || "");
  const compact = t.replace(/\s+/g, "");
  let best = null;
  for (const b of GC_BRANDS) {
    const re = /^[A-Za-z0-9]+$/.test(b) ? new RegExp("(^|[^A-Za-z0-9])" + b + "($|[^A-Za-z0-9])", "i") : null;
    const idx = re ? t.search(re) : compact.indexOf(b);
    if (idx < 0) continue;
    const pos = re ? idx : compact.indexOf(b) / Math.max(compact.length, 1) * t.length;
    if (!best || pos < best.pos) best = { name: b, pos };
  }
  return best ? best.name : "";
}

function gcParseBrand(text) {
  const lines = gcLines(text);
  const v = gcLabelValue(lines, "교\\s*환\\s*처|사\\s*용\\s*처");
  if (v && !GC_JUNK_VALUE.test(v) && v.length <= 30) return v;
  const known = gcKnownBrand(text);
  if (known) return known;
  for (const l of lines) {
    const m = l.match(/^\[([^\]]{1,20})\]/);
    if (m) return m[1].trim();
  }
  return "";
}

const GC_SKIP_LINE = /유\s*효\s*기\s*간|유\s*효\s*기\s*한|교\s*환\s*처|사\s*용\s*처|사\s*용\s*기\s*간|사\s*용\s*기\s*한|이\s*용\s*기\s*간|사\s*용\s*조\s*건|주\s*문\s*번\s*호|선\s*물\s*하\s*기|쿠\s*폰\s*번\s*호|쿠\s*폰\s*상\s*세|쿠\s*폰\s*명|상\s*품\s*명|바\s*코\s*드|사\s*용\s*완\s*료|사\s*용\s*가\s*능|사\s*용\s*하\s*기|사\s*용\s*할\s*까|사\s*용\s*방\s*법|유\s*의\s*사\s*항|상\s*세\s*보\s*기|남\s*았\s*어\s*요|만\s*료\s*일|시\s*크\s*릿|^매\s*장$|^공\s*유$|저\s*장|선\s*물\s*함|보\s*낸\s*사\s*람|받\s*은\s*사\s*람|메\s*시\s*지|카\s*카\s*오\s*톡|선물이 도착|확인|닫기|^D-\d+|^\s*from\b|^\s*to\b/i;

function gcCandidateLines(text) {
  return gcLines(text)
    .map((l) => (/^([가-힣] )+[가-힣]$/.test(l) ? l.replace(/ /g, "") : l))
    .filter((l) => {
      if (l.replace(/\s/g, "").length < 2) return false;
      if (GC_SKIP_LINE.test(l)) return false;
      const digits = l.replace(/\D/g, "").length;
      if (digits / l.replace(/\s/g, "").length > 0.5) return false; // 숫자·시간 위주
      if (!/[가-힣A-Za-z]/.test(l)) return false;
      return true;
    });
}

function gcStripBrand(name, brand) {
  let n = name.replace(/^\[[^\]]{1,20}\]\s*/, "");
  if (brand && n.replace(/\s/g, "").startsWith(brand.replace(/\s/g, "")) && n.length > brand.length + 1) {
    n = n.slice(brand.length).replace(/^[\s)\]:·-]+/, "");
  }
  return n.trim();
}

function gcParseText(text) {
  const lines = gcLines(text);
  let brand = gcParseBrand(text);
  const cands = gcCandidateLines(text);
  // 아는 브랜드가 없으면 맨 위 두 줄을 교환처 / 상품명으로 봐요
  if (!brand && cands.length >= 2 && !gcLabelValue(lines, "쿠\\s*폰\\s*명|상\\s*품\\s*명")) brand = cands[0];
  const sameAsBrand = (l) => brand && l.replace(/\s/g, "").toLowerCase() === brand.replace(/\s/g, "").toLowerCase();

  // 1) "쿠폰명 / 상품명" 라벨이 있으면 그 값
  let name = gcLabelValue(lines, "쿠\\s*폰\\s*명|상\\s*품\\s*명");
  // 2) 교환처 이름이 들어간 줄 (예: [GS25] 롯데) 아몬드빼빼로)
  if (!name && brand) {
    const withBrand = cands.find((l) => !sameAsBrand(l) && l.replace(/\s/g, "").toLowerCase().includes(brand.replace(/\s/g, "").toLowerCase()));
    if (withBrand) name = withBrand;
  }
  // 3) 교환처만 있는 줄 바로 다음 줄 (예: GS25 / 농심)육개장사발면)
  if (!name && brand) {
    const i = cands.findIndex(sameAsBrand);
    if (i >= 0 && cands[i + 1] && !sameAsBrand(cands[i + 1])) name = cands[i + 1];
  }
  // 4) 그래도 없으면 첫 번째 후보 줄
  if (!name) name = cands.find((l) => !sameAsBrand(l)) || "";
  name = gcStripBrand(name, brand);

  return {
    brand: brand.slice(0, 40),
    name: name.slice(0, 60),
    expiry: gcParseExpiry(text),
    barcodes: gcBarcodeCandidates(text),
    used: gcIsUsedText(text),
  };
}
// ---- 여기까지 공통 코드 ----

/* ================= 기본 준비 ================= */
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const screenEl = document.getElementById("screen");
const DAY = 86400000;

const state = {
  user: null,
  items: [],
  inbox: [],
  settings: null,
  view: "loading",
  tab: "available",
  detailId: null,
  review: null,
  authMode: "login",
  pushOn: false,
};

const ICON = {
  bell: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2E2416" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
  back: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#2E2416" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
  close: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2E2416" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
  closeSmall: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7A6A55" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
  check: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
  image: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3D2A12" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/></svg>',
  gift: '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#3D2A12" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5"/></svg>',
};

const TILES = [
  ["#FFF1C7", "#6B4E00"],
  ["#FFE0C7", "#8A3B05"],
  ["#FFE3D6", "#8F3A1E"],
  ["#FDE7B9", "#6E4A00"],
  ["#F8EBD8", "#5E4524"],
];

/* ================= 작은 도구들 ================= */
function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
let toastTimer;
function toast(msg, ms = 2600) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), ms);
}
function busy(text) {
  document.getElementById("busy-text").textContent = text || "잠시만요…";
  document.getElementById("busy").hidden = false;
}
function unbusy() {
  document.getElementById("busy").hidden = true;
}
function todayKST() {
  return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
}
function ymdToUTC(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}
function ddays(ymd) {
  return Math.round((ymdToUTC(ymd) - ymdToUTC(todayKST())) / DAY);
}
function ddayLabel(ymd) {
  const n = ddays(ymd);
  if (n === 0) return "오늘";
  if (n === 1) return "내일";
  if (n > 1) return "D-" + n;
  return "만료";
}
function md(ymd) {
  const [, m, d] = ymd.split("-").map(Number);
  return `${m}.${d}`;
}
function fullDate(ymd) {
  return ymd.replace(/-/g, ".");
}
function shiftDate(ymd, n) {
  return new Date(ymdToUTC(ymd) + n * DAY).toISOString().slice(0, 10);
}
function tileOf(brand) {
  let h = 0;
  for (const ch of String(brand || "?")) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return TILES[h % TILES.length];
}
function initialOf(item) {
  const s = (item.brand || item.name || "?").trim();
  if (/^[A-Za-z0-9]/.test(s)) return s.slice(0, 2).toUpperCase();
  return s.slice(0, 1);
}
function hhmm(t) {
  return String(t || "10:00").slice(0, 5);
}
function timeKo(t) {
  const [h, m] = hhmm(t).split(":").map(Number);
  const ampm = h < 12 ? "오전" : "오후";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${ampm} ${h12}시${m ? " " + m + "분" : ""}`;
}
function statusOf(item) {
  if (item.used_at) return "used";
  if (ddays(item.expires_on) < 0) return "expired";
  return "available";
}
function groupDigits(v) {
  const s = String(v || "");
  return /^\d+$/.test(s) ? s.replace(/(\d{4})(?=\d)/g, "$1 ") : s;
}
function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)
  );
}
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error("불러오기 실패: " + src));
    document.head.appendChild(s);
  });
}
function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}
function isIOS() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent);
}
function errMsg(e) {
  const m = (e && (e.message || e.error_description)) || String(e);
  if (/Invalid login credentials/i.test(m)) return "이메일 또는 비밀번호가 맞지 않아요";
  if (/Email not confirmed/i.test(m)) return "메일 인증을 먼저 해 주세요";
  if (/already registered|already exists/i.test(m)) return "이미 가입된 이메일이에요";
  if (/Password should be at least/i.test(m)) return "비밀번호는 6자 이상이어야 해요";
  if (/rate limit/i.test(m)) return "요청이 많아요. 잠시 뒤에 다시 해 주세요";
  if (/duplicate key|23505/i.test(m)) return "이미 등록된 바코드예요";
  if (/Failed to fetch|NetworkError/i.test(m)) return "인터넷 연결을 확인해 주세요";
  return m;
}

/* ================= 데이터 ================= */
async function loadAll() {
  const [items, inbox] = await Promise.all([
    sb.from("gifticon_items").select("*").order("expires_on", { ascending: true }),
    sb.from("gifticon_inbox").select("*").order("created_at", { ascending: true }),
  ]);
  if (items.error) throw items.error;
  state.items = items.data || [];
  state.inbox = inbox.error ? [] : inbox.data || [];
  if (!state.settings) await ensureSettings();
}

async function ensureSettings() {
  const { data, error } = await sb.from("gifticon_settings").select("*").maybeSingle();
  if (error) throw error;
  if (data) {
    state.settings = data;
    return;
  }
  const ins = await sb.from("gifticon_settings").insert({ user_id: state.user.id }).select().single();
  if (ins.error) throw ins.error;
  state.settings = ins.data;
}

async function saveSettings(patch) {
  const prev = state.settings;
  state.settings = { ...prev, ...patch };
  render();
  const { error } = await sb
    .from("gifticon_settings")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("user_id", state.user.id);
  if (error) {
    state.settings = prev;
    render();
    toast("저장하지 못했어요: " + errMsg(error));
  }
}

function itemById(id) {
  return state.items.find((i) => i.id === id);
}
function findByBarcode(code, onlyUnused = false) {
  const n = gcNormalizeBarcode(code);
  return state.items.find((i) => gcNormalizeBarcode(i.barcode) === n && (!onlyUnused || !i.used_at));
}
async function removeImage(path) {
  if (path) await sb.storage.from(BUCKET).remove([path]);
}

/* ================= 화면 그리기 ================= */
function go(view, extra = {}) {
  Object.assign(state, extra, { view });
  render();
  window.scrollTo(0, 0);
}

function render() {
  const v = state.view;
  if (v === "auth") screenEl.innerHTML = viewAuth();
  else if (v === "home") screenEl.innerHTML = viewHome();
  else if (v === "detail") {
    screenEl.innerHTML = viewDetail();
    drawBarcode();
  } else if (v === "review") screenEl.innerHTML = viewReview();
  else if (v === "settings") screenEl.innerHTML = viewSettings();
  else screenEl.innerHTML = '<div class="loading"><div class="spinner" aria-label="불러오는 중"></div></div>';
}

/* ---------- 로그인 ---------- */
function viewAuth() {
  const signup = state.authMode === "signup";
  return `
  <div class="auth">
    <div>
      <div class="logo">${ICON.gift}</div>
      <h1>기프티콘함</h1>
      <p class="lead">캡쳐만 해두면 알아서 정리하고<br>만료 전에 알려드려요</p>
    </div>
    <form data-submit="auth">
      <label class="field">이메일
        <input type="email" name="email" autocomplete="email" required placeholder="name@example.com">
      </label>
      <label class="field">비밀번호
        <input type="password" name="password" autocomplete="${signup ? "new-password" : "current-password"}" required minlength="6" placeholder="${signup ? "6자 이상" : "비밀번호 입력"}">
      </label>
      <button class="primary" type="submit">${signup ? "가입하기" : "로그인"}</button>
    </form>
    <div class="switch">
      <span>${signup ? "이미 계정이 있나요?" : "처음이신가요?"}</span>
      <button type="button" class="text-btn" data-action="toggleAuth">${signup ? "로그인" : "회원가입"}</button>
    </div>
    <p class="foot">각자 로그인하면 내 기프티콘만 보여요</p>
  </div>`;
}

/* ---------- 목록 ---------- */
function reviewCount() {
  return state.items.filter((i) => i.needs_review && !i.used_at).length + state.inbox.length;
}

function rowHTML(item, soon) {
  const [bg, fg] = tileOf(item.brand);
  const st = statusOf(item);
  let side = "";
  if (st === "available") {
    side = soon
      ? `<span class="badge-urgent">${ddayLabel(item.expires_on)}</span>`
      : `<div class="side"><b>${ddayLabel(item.expires_on)}</b><small>${md(item.expires_on)}</small></div>`;
  } else if (st === "used") {
    side = `<div class="side"><b>사용 완료</b><small>${md(new Date(new Date(item.used_at).getTime() + 9 * 3600000).toISOString().slice(0, 10))}</small></div>`;
  } else {
    side = `<div class="side"><b>만료</b><small>${md(item.expires_on)}</small></div>`;
  }
  return `
  <button type="button" class="row${soon ? " soon" : ""}" data-action="openDetail" data-id="${item.id}">
    <span class="tile" style="background:${bg};color:${fg}">${esc(initialOf(item))}</span>
    <span class="meta">
      <span class="brand">${esc(item.brand || "교환처 미입력")}${item.needs_review ? '<span class="chip-new">새로 등록</span>' : ""}</span>
      <span class="name">${esc(item.name || "상품명 미입력")}</span>
      ${soon ? `<span class="brand">${fullDate(item.expires_on)}까지</span>` : ""}
    </span>
    ${side}
  </button>`;
}

function viewHome() {
  const avail = state.items.filter((i) => statusOf(i) === "available");
  const used = state.items.filter((i) => statusOf(i) === "used").sort((a, b) => (b.used_at || "").localeCompare(a.used_at || ""));
  const expired = state.items.filter((i) => statusOf(i) === "expired").sort((a, b) => b.expires_on.localeCompare(a.expires_on));
  const rc = reviewCount();
  const auto = state.items.filter((i) => i.needs_review && !i.used_at).length;

  let banner = "";
  if (rc > 0) {
    const parts = [];
    if (auto) parts.push(`단축어로 <b>${auto}개</b>가 새로 등록됐어요`);
    if (state.inbox.length) parts.push(`확인할 캡쳐 <b>${state.inbox.length}장</b>이 있어요`);
    banner = `<div class="banner">${ICON.check}<span>${parts.join(" · ")}</span><button type="button" data-action="startReview">확인</button></div>`;
  }

  let body = "";
  if (state.tab === "available") {
    const soon = avail.filter((i) => ddays(i.expires_on) <= 7);
    const rest = avail.filter((i) => ddays(i.expires_on) > 7);
    if (!avail.length) {
      body = `<div class="empty">아직 등록된 기프티콘이 없어요.<br>아래 <b>캡쳐 불러오기</b>를 눌러 추가해 보세요.</div>`;
    } else {
      if (soon.length)
        body += `<section class="section"><h3 class="list-title urgent">곧 만료돼요</h3>${soon.map((i) => rowHTML(i, true)).join("")}</section>`;
      if (rest.length)
        body += `<section class="section"><h3 class="list-title">만료 임박순</h3>${rest.map((i) => rowHTML(i, false)).join("")}</section>`;
    }
  } else if (state.tab === "used") {
    body = used.length
      ? `<section class="section">${used.map((i) => rowHTML(i, false)).join("")}</section>`
      : `<div class="empty">사용 완료한 기프티콘이 여기에 모여요.</div>`;
  } else {
    body = expired.length
      ? `<section class="section">${expired.map((i) => rowHTML(i, false)).join("")}</section>`
      : `<div class="empty">기한이 지난 기프티콘이 없어요.</div>`;
  }

  const tab = (id, label) =>
    `<button type="button" role="tab" aria-selected="${state.tab === id}" data-action="tab" data-tab="${id}">${label}</button>`;

  return `
  <header class="home-head">
    <h1>내 기프티콘</h1>
    <button type="button" class="icon-btn filled" data-action="openSettings" aria-label="알림 설정">${ICON.bell}</button>
  </header>
  ${banner}
  <div class="tabs" role="tablist">
    ${tab("available", `사용 가능${avail.length ? " " + avail.length : ""}`)}
    ${tab("used", "사용 완료")}
    ${tab("expired", "기한 만료")}
  </div>
  ${body}
  <div style="height:150px"></div>
  <div class="bottom-bar" style="position:fixed;left:0;right:0;max-width:480px;margin:0 auto">
    <button type="button" class="primary" data-action="runShortcut">${ICON.image} 지금 불러오기</button>
    <label class="text-btn fab-label" style="align-self:center;display:flex;align-items:center">
      사진에서 직접 고르기
      <input type="file" accept="image/*" multiple data-change="pickFiles" aria-label="사진에서 직접 고르기">
    </label>
  </div>`;
}

/* ---------- 바코드 보기 ---------- */
function alarmPlan(item) {
  const s = state.settings || {};
  const out = [];
  if (s.first_offset !== null && s.first_offset !== undefined)
    out.push({ stage: 1, date: shiftDate(item.expires_on, -s.first_offset), time: s.first_time });
  if (s.second_offset !== null && s.second_offset !== undefined)
    out.push({ stage: 2, date: shiftDate(item.expires_on, -s.second_offset), time: s.second_time });
  return out;
}

function viewDetail() {
  const item = itemById(state.detailId);
  if (!item) return viewHome();
  const st = statusOf(item);
  const d = ddays(item.expires_on);
  let badge = "";
  if (st === "available" && d <= 7) badge = `<span class="badge-urgent">${d === 0 ? "오늘 만료" : d === 1 ? "내일 만료" : d + "일 남음"}</span>`;
  if (st === "expired") badge = `<span class="badge-urgent">기한 만료</span>`;

  let alarm = "";
  if (st === "used") alarm = "사용 완료 · 알림 없음";
  else if (st === "expired") alarm = "-";
  else {
    const plan = alarmPlan(item);
    alarm = plan.length ? plan.map((p) => `${p.stage}차 ${md(p.date)}`).join(" · ") : "꺼짐";
  }

  return `
  <header class="topbar">
    <button type="button" class="icon-btn" data-action="home" aria-label="뒤로">${ICON.back}</button>
    <span style="flex:1"></span>
    <button type="button" class="text-btn" data-action="editItem">정보 수정</button>
    ${item.image_path ? `<button type="button" class="text-btn" data-action="viewOriginal">원본 캡쳐</button>` : ""}
  </header>
  <div class="detail-title">
    <span>${esc(item.brand || "교환처 미입력")}</span>
    <h2>${esc(item.name || "상품명 미입력")}</h2>
  </div>
  <div class="barcode-card${st === "used" ? " used" : ""}" id="barcode-card">
    <svg id="barcode-svg" role="img" aria-label="바코드"></svg>
    <span class="barcode-num">${esc(groupDigits(item.barcode))}</span>
  </div>
  <dl class="facts">
    <div><dt>유효기간</dt><dd>${fullDate(item.expires_on)} ${badge}</dd></div>
    <div><dt>교환처</dt><dd>${esc(item.brand || "-")}</dd></div>
    <div><dt>알림</dt><dd>${alarm}</dd></div>
  </dl>
  <div class="bottom-bar">
    ${
      st === "used"
        ? `<button type="button" class="secondary" data-action="toggleUsed">사용 취소하기</button>`
        : `<p class="info">사용 완료하면 남은 알림은 울리지 않아요. 카톡에서 ‘사용완료’ 도장이 찍힌 화면을 캡쳐해도 자동으로 처리돼요</p>
           <button type="button" class="primary" data-action="toggleUsed">${ICON.check} 사용 완료로 표시</button>`
    }
    <button type="button" class="danger-link" data-action="deleteItem">이 기프티콘 삭제</button>
  </div>`;
}

const JSB_FORMAT = {
  CODE_128: "CODE128", EAN_13: "EAN13", EAN_8: "EAN8", UPC_A: "UPC",
  ITF: "ITF", CODE_39: "CODE39", CODABAR: "codabar",
};

async function drawBarcode() {
  const item = itemById(state.detailId);
  const svg = document.getElementById("barcode-svg");
  if (!item || !svg) return;
  const fmt = JSB_FORMAT[String(item.barcode_format || "").toUpperCase()];
  const qr = /QR|DATA_MATRIX|AZTEC|PDF_417/i.test(item.barcode_format || "");
  if (!qr && window.JsBarcode) {
    const opts = { displayValue: false, margin: 0, height: 100, width: 2, background: "#FFFFFF", lineColor: "#1E1810" };
    try {
      JsBarcode(svg, item.barcode, { ...opts, format: fmt || "CODE128" });
      return;
    } catch (e) {
      try {
        JsBarcode(svg, item.barcode, { ...opts, format: "CODE128" });
        return;
      } catch (e2) {}
    }
  }
  // QR 코드 등은 원본 캡쳐를 그대로 보여줘요
  if (item.image_path) {
    const { data } = await sb.storage.from(BUCKET).createSignedUrl(item.image_path, 600);
    if (data && data.signedUrl) {
      const img = document.createElement("img");
      img.src = data.signedUrl;
      img.alt = "원본 캡쳐";
      svg.replaceWith(img);
    }
  }
}

/* ---------- 등록 확인 ---------- */
function viewReview() {
  const r = state.review;
  if (!r) return viewHome();
  const n = r.cands.length;
  const notes = [];
  if (r.skipped) notes.push(`바코드가 없는 스크린샷 ${r.skipped}장은 건너뛰었어요`);
  if (r.dup) notes.push(`이미 등록된 ${r.dup}장은 뺐어요`);
  if (r.used) notes.push(`${r.used}개는 사용 완료로 바꿨어요`);
  const title = r.edit ? "정보 수정" : n ? `새 기프티콘 ${n}개를 찾았어요` : "확인할 기프티콘이 없어요";

  const cards = r.cands
    .map((c) => {
      const warnExp = !c.expiry || c.warnExpiry;
      const warnCode = !c.barcode || c.warnBarcode;
      return `
    <div class="cand${warnExp || warnCode ? " warn" : ""}">
      ${c.preview ? `<img class="thumb" src="${esc(c.preview)}" alt="">` : `<div class="thumb"></div>`}
      <div class="fields">
        <label>교환처
          <input value="${esc(c.brand)}" data-input="cand" data-key="${c.key}" data-field="brand" style="font-weight:700" autocomplete="off">
        </label>
        <label>상품명
          <input value="${esc(c.name)}" data-input="cand" data-key="${c.key}" data-field="name" autocomplete="off">
        </label>
        <label class="${warnExp ? "warn-label" : ""}">유효기간${warnExp ? (c.expiry ? " · 글자가 흐려서 확인해 주세요" : " · 날짜를 입력해 주세요") : ""}
          <input type="date" value="${esc(c.expiry || "")}" data-input="cand" data-key="${c.key}" data-field="expiry">
        </label>
        <label class="${warnCode ? "warn-label" : ""}">바코드 번호${warnCode ? (c.barcode ? " · 캡쳐 글자로 읽었어요, 확인해 주세요" : " · 번호를 입력해 주세요") : ""}
          <input inputmode="numeric" value="${esc(c.barcode)}" data-input="cand" data-key="${c.key}" data-field="barcode" autocomplete="off">
        </label>
        ${c.note ? `<p class="note">${esc(c.note)}</p>` : ""}
      </div>
      ${r.edit ? "" : `<button type="button" class="icon-btn remove" data-action="dropCand" data-key="${c.key}" aria-label="기프티콘이 아니에요, 빼기">${ICON.closeSmall}</button>`}
    </div>`;
    })
    .join("");

  return `
  <header class="topbar">
    <button type="button" class="icon-btn" data-action="closeReview" aria-label="닫기">${ICON.close}</button>
  </header>
  <div class="review-head">
    <h2>${title}</h2>
    ${notes.length ? `<p>${notes.join(" · ")}</p>` : ""}
  </div>
  <section class="section" style="gap:12px">${cards}</section>
  <div class="bottom-bar">
    ${n && !r.edit ? `<p class="muted" style="margin:0;font-size:13px;text-align:center">이미 있는 바코드는 중복 등록되지 않아요</p>` : ""}
    ${n ? `<button type="button" class="primary" data-action="confirmReview">${r.edit ? "저장하기" : n + "개 등록하기"}</button>` : `<button type="button" class="secondary" data-action="closeReview">돌아가기</button>`}
  </div>`;
}

/* ---------- 설정 ---------- */
const OFFSETS = [
  { id: 7, label: "7일 전" },
  { id: 3, label: "3일 전" },
  { id: 0, label: "당일" },
];

function viewSettings() {
  const s = state.settings || {};
  const first = s.first_offset;
  const second = s.second_offset;
  const pill = (stage, o) => {
    const checked = stage === 1 ? o.id === first : o.id === second;
    const disabled = stage === 2 && !(o.id < first);
    return `<button type="button" role="radio" aria-checked="${checked && !disabled}" ${disabled ? "disabled" : ""} data-action="pickOffset" data-stage="${stage}" data-offset="${o.id}">${o.label}</button>`;
  };
  const day = (n) => `12월 ${10 - n}일`;
  const example =
    second === null || second === undefined
      ? `${day(first)} ${timeKo(s.first_time)}에 한 번 알려드려요`
      : `1차 ${day(first)} ${timeKo(s.first_time)}, 2차 ${day(second)} ${timeKo(s.second_time)}`;

  const pushBlock = state.pushOn
    ? `<div class="set-head"><b>이 기기에서 알림 받기</b><span class="status on">켜짐</span></div>
       <button type="button" class="secondary" data-action="testPush">알림이 오는지 확인하기</button>`
    : `<div class="set-head"><b>이 기기에서 알림 받기</b><span class="status off">꺼짐</span></div>
       ${
         isIOS() && !isStandalone()
           ? `<p class="muted" style="margin:0;font-size:14px;line-height:1.6">아이폰은 Safari 공유 버튼 → <b>홈 화면에 추가</b>로 설치한 앱에서만 알림을 켤 수 있어요.</p>`
           : `<button type="button" class="primary" data-action="enablePush">알림 켜기</button>`
       }`;

  return `
  <header class="topbar">
    <button type="button" class="icon-btn" data-action="home" aria-label="뒤로">${ICON.back}</button>
    <h1>설정</h1>
  </header>

  <section class="section" style="padding-top:12px">
    <div style="margin:0 4px">
      <h2 style="margin:0;font-size:14px;color:var(--sub)">만료 알림</h2>
      <p class="muted" style="margin:2px 0 0;font-size:13px">내 계정에만 적용돼요</p>
    </div>
    <div class="set-card">
      <div class="set-head"><b>1차 알림</b>
        <label>시간 <input type="time" value="${hhmm(s.first_time)}" data-change="time" data-field="first_time"></label>
      </div>
      <div class="pills" role="radiogroup" aria-label="1차 알림 시기">${OFFSETS.map((o) => pill(1, o)).join("")}</div>
    </div>
    <div class="set-card">
      <div class="set-head"><b>2차 알림</b>
        <label>시간 <input type="time" value="${hhmm(s.second_time)}" data-change="time" data-field="second_time" ${second === null ? "disabled" : ""}></label>
      </div>
      <div class="pills" role="radiogroup" aria-label="2차 알림 시기">${OFFSETS.map((o) => pill(2, o)).join("")}</div>
      ${second === null || second === undefined ? `<p class="muted" style="margin:0;font-size:13px">1차 알림이 당일이면 2차 알림은 없어요</p>` : ""}
    </div>
    <div class="info" style="display:flex;flex-direction:column;gap:6px">
      <b style="display:flex;align-items:center;gap:8px;font-size:14px">${ICON.check} 1차 알림 뒤에 사용하면 2차 알림은 울리지 않아요</b>
      <span>예) 12월 10일까지인 기프티콘 → ${example}</span>
    </div>
    <div class="set-card">${pushBlock}</div>
  </section>

  <section class="section">
    <h2>캡쳐 자동 등록 (아이폰 단축어)</h2>
    <div class="set-card">
      <p class="muted" style="margin:0;font-size:14px;line-height:1.6">단축어를 한 번 만들어 두면, 최근 스크린샷 중 기프티콘만 골라서 자동으로 등록돼요. 아래 두 가지를 단축어에 붙여넣어요.</p>
      <div style="display:flex;flex-direction:column;gap:6px">
        <span style="font-size:13px;font-weight:700;color:var(--sub)">보낼 주소</span>
        <div class="code-box"><span>${INGEST_URL}</span><button type="button" data-action="copy" data-value="${INGEST_URL}">복사</button></div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px">
        <span style="font-size:13px;font-weight:700;color:var(--sub)">내 연결 코드 <span class="muted" style="font-weight:400">(다른 사람에게 알려주지 마세요)</span></span>
        <div class="code-box"><span>${esc(s.upload_token || "")}</span><button type="button" data-action="copy" data-value="${esc(s.upload_token || "")}">복사</button></div>
      </div>
      <details class="howto">
        <summary>단축어 만드는 법</summary>
        <ol>
          <li><b>단축어</b> 앱 → <b>+</b> → 이름을 <b>${SHORTCUT_NAME}</b>로 정해요. (띄어쓰기까지 똑같이)</li>
          <li><b>사진 찾기</b> 추가 → 필터: <b>스크린샷</b>이 <b>참</b>, <b>생성일</b>이 <b>최근 2일</b>.</li>
          <li><b>각 항목을 반복</b> 추가 → 그 안에 <b>이미지에서 텍스트 추출</b>(입력: 반복 항목).</li>
          <li><b>만약</b> 추가 → 조건: 텍스트가 <b>유효기간</b>을 포함. 조건 추가로 <b>유효기한</b>, <b>사용기한</b>, <b>교환처</b>도 넣고 <b>다음 중 하나라도</b>로 바꿔요.</li>
          <li>만약 안에: <b>이미지 크기 조절</b>(반복 항목, 너비 1080) → <b>이미지 변환</b>(JPEG).</li>
          <li>이어서 <b>URL 콘텐츠 가져오기</b>: URL에 <b>보낼 주소</b>, 방법 <b>POST</b>, 헤더 <b>x-upload-token</b> = <b>내 연결 코드</b>, 본문 <b>양식</b> → 파일 <b>file</b> = 변환된 이미지, 텍스트 <b>text</b> = 추출된 텍스트.</li>
          <li>단축어를 한 번 직접 실행하고, 사진·인터넷 접근을 물으면 <b>항상 허용</b>을 눌러요.</li>
          <li><b>자동화</b> 탭 → <b>새로운 자동화</b> → <b>특정 시간</b>(예: 매일 밤 11시) → <b>즉시 실행</b> → 동작: <b>단축어 실행</b> → <b>${SHORTCUT_NAME}</b>.</li>
        </ol>
      </details>
      <button type="button" class="text-btn" style="align-self:flex-start;padding:0" data-action="resetToken">연결 코드 새로 만들기</button>
    </div>
  </section>

  <section class="section">
    <h2>계정</h2>
    <div class="card account">
      <span>${esc(state.user ? state.user.email : "")}</span>
      <button type="button" class="text-btn" data-action="logout">로그아웃</button>
    </div>
  </section>
  <div class="spacer"></div>`;
}

/* ================= 바코드·글자 인식 ================= */
async function blobToCanvas(blob, maxW = 1080) {
  let src;
  if (window.createImageBitmap) {
    try {
      src = await createImageBitmap(blob);
    } catch (e) {
      src = null;
    }
  }
  if (!src) {
    src = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("이미지를 열 수 없어요"));
      img.src = URL.createObjectURL(blob);
    });
  }
  const w0 = src.width || src.naturalWidth;
  const h0 = src.height || src.naturalHeight;
  const scale = Math.min(1, maxW / w0);
  const c = document.createElement("canvas");
  c.width = Math.round(w0 * scale);
  c.height = Math.round(h0 * scale);
  c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
  return c;
}

function scaledCanvas(canvas, f) {
  const c = document.createElement("canvas");
  c.width = Math.round(canvas.width * f);
  c.height = Math.round(canvas.height * f);
  c.getContext("2d").drawImage(canvas, 0, 0, c.width, c.height);
  return c;
}

function canvasToJpeg(canvas) {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", 0.85));
}

let zxingReady;
async function decodeBarcode(canvas) {
  if ("BarcodeDetector" in window) {
    try {
      const det = new window.BarcodeDetector();
      const found = await det.detect(canvas);
      if (found && found.length) return { text: found[0].rawValue, format: String(found[0].format || "").toUpperCase() };
    } catch (e) {}
  }
  try {
    zxingReady = zxingReady || loadScript(ZXING_URL);
    await zxingReady;
  } catch (e) {
    zxingReady = null;
    return null;
  }
  const Z = window.ZXing;
  const F = Z.BarcodeFormat;
  const hints = new Map();
  hints.set(Z.DecodeHintType.TRY_HARDER, true);
  hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [
    F.CODE_128, F.EAN_13, F.EAN_8, F.ITF, F.CODE_39, F.UPC_A, F.CODABAR, F.QR_CODE,
  ]);
  const tries = [canvas, scaledCanvas(canvas, 0.6)];
  if (canvas.width < 700) tries.push(scaledCanvas(canvas, 1.6));
  for (const c of tries) {
    const w = c.width;
    const h = c.height;
    const px = c.getContext("2d").getImageData(0, 0, w, h).data;
    const lum = new Uint8ClampedArray(w * h);
    for (let i = 0, j = 0; i < px.length; i += 4, j++) {
      lum[j] = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
    }
    try {
      const source = new Z.RGBLuminanceSource(lum, w, h);
      const bitmap = new Z.BinaryBitmap(new Z.HybridBinarizer(source));
      const reader = new Z.MultiFormatReader();
      reader.setHints(hints);
      const r = reader.decode(bitmap, hints);
      return { text: r.getText(), format: F[r.getBarcodeFormat()] || null };
    } catch (e) {}
  }
  return null;
}

let ocrWorker;
async function ocr(canvas) {
  try {
    if (!ocrWorker) {
      ocrWorker = (async () => {
        await loadScript(TESSERACT_URL);
        return window.Tesseract.createWorker("kor+eng");
      })();
    }
    const worker = await ocrWorker;
    const { data } = await worker.recognize(canvas);
    return (data && data.text) || "";
  } catch (e) {
    ocrWorker = null;
    console.warn("OCR 실패", e);
    return "";
  }
}

// 이미지 한 장 분석: 바코드 → 글자 → 정보
async function analyze(blob, givenText, wantOcr) {
  const canvas = await blobToCanvas(blob);
  const code = await decodeBarcode(canvas);
  let text = givenText || "";
  if (!text.trim() && (code || wantOcr)) text = await ocr(canvas);
  const p = gcParseText(text);
  const barcode = code ? gcNormalizeBarcode(code.text) : p.barcodes[0] || "";
  return {
    canvas,
    text,
    parsed: p,
    barcode,
    format: code ? code.format : null,
    fromText: !code && !!barcode,
  };
}

/* ================= 등록 흐름 ================= */
function newReview(edit = false) {
  return { cands: [], skipped: 0, dup: 0, used: 0, edit };
}

// 단축어로 들어온 것 확인
async function startReview() {
  const r = newReview();
  const seen = new Set();
  const autoItems = state.items.filter((i) => i.needs_review && !i.used_at);
  const total = autoItems.length + state.inbox.length;
  let k = 0;
  try {
    for (const item of autoItems) {
      busy(`캡쳐 확인 중 ${++k}/${total}`);
      let preview = "";
      let barcode = item.barcode;
      let format = item.barcode_format;
      let warnBarcode = true;
      let note = "";
      if (item.image_path) {
        const dl = await sb.storage.from(BUCKET).download(item.image_path);
        if (dl.data) {
          preview = URL.createObjectURL(dl.data);
          const canvas = await blobToCanvas(dl.data);
          const code = await decodeBarcode(canvas);
          if (code) {
            barcode = gcNormalizeBarcode(code.text);
            format = code.format;
            warnBarcode = false;
          } else {
            note = "이미지에서 바코드를 못 찾았어요. 기프티콘이 아니면 오른쪽 위 X로 빼 주세요";
          }
        }
      }
      seen.add(barcode);
      r.cands.push({
        key: "i" + item.id, kind: "item", itemId: item.id, imagePath: item.image_path, preview,
        brand: item.brand, name: item.name, expiry: item.expires_on, barcode, format,
        warnExpiry: false, warnBarcode, note,
      });
    }

    for (const row of state.inbox) {
      busy(`캡쳐 확인 중 ${++k}/${total}`);
      const dl = await sb.storage.from(BUCKET).download(row.image_path);
      if (!dl.data) {
        await sb.from("gifticon_inbox").delete().eq("id", row.id);
        continue;
      }
      const a = await analyze(dl.data, row.ocr_text, true);
      const drop = async () => {
        await sb.from("gifticon_inbox").delete().eq("id", row.id);
        await removeImage(row.image_path);
      };
      if (!a.barcode) {
        r.skipped++;
        await drop();
        continue;
      }
      if (a.parsed.used) {
        const hit = findByBarcode(a.barcode, true);
        if (hit) await sb.from("gifticon_items").update({ used_at: new Date().toISOString() }).eq("id", hit.id);
        if (hit) r.used++;
        else r.skipped++;
        await drop();
        continue;
      }
      if (findByBarcode(a.barcode) || seen.has(a.barcode)) {
        r.dup++;
        await drop();
        continue;
      }
      seen.add(a.barcode);
      r.cands.push({
        key: "x" + row.id, kind: "inbox", inboxId: row.id, imagePath: row.image_path,
        preview: URL.createObjectURL(dl.data),
        brand: a.parsed.brand, name: a.parsed.name, expiry: a.parsed.expiry || "",
        barcode: a.barcode, format: a.format, warnExpiry: !a.parsed.expiry, warnBarcode: a.fromText, note: "",
      });
    }
  } catch (e) {
    toast("확인 중 문제가 생겼어요: " + errMsg(e));
  } finally {
    unbusy();
  }
  await refresh(false);
  if (!r.cands.length) {
    const msg = [r.used && `${r.used}개 사용 완료 처리`, r.dup && `${r.dup}장 중복`, r.skipped && `${r.skipped}장 건너뜀`].filter(Boolean).join(", ");
    toast(msg ? `새 기프티콘은 없어요 (${msg})` : "확인할 캡쳐가 없어요");
    go("home");
    return;
  }
  go("review", { review: r });
}

// 앱에서 직접 고른 캡쳐
async function handleFiles(files) {
  const list = Array.from(files || []).filter((f) => /^image\//.test(f.type) || /\.(heic|jpe?g|png|webp)$/i.test(f.name));
  if (!list.length) return;
  const r = newReview();
  const seen = new Set();
  try {
    for (let i = 0; i < list.length; i++) {
      busy(`캡쳐 읽는 중 ${i + 1}/${list.length}${i === 0 ? "\n처음엔 글자 인식 준비로 조금 걸려요" : ""}`);
      const a = await analyze(list[i], "", true);
      if (!a.barcode) {
        r.skipped++;
        continue;
      }
      if (a.parsed.used) {
        const hit = findByBarcode(a.barcode, true);
        if (hit) {
          await sb.from("gifticon_items").update({ used_at: new Date().toISOString() }).eq("id", hit.id);
          r.used++;
        } else r.skipped++;
        continue;
      }
      if (findByBarcode(a.barcode) || seen.has(a.barcode)) {
        r.dup++;
        continue;
      }
      seen.add(a.barcode);
      const blob = await canvasToJpeg(a.canvas);
      r.cands.push({
        key: "f" + i + "_" + Date.now(), kind: "file", blob, preview: URL.createObjectURL(blob),
        brand: a.parsed.brand, name: a.parsed.name, expiry: a.parsed.expiry || "",
        barcode: a.barcode, format: a.format, warnExpiry: !a.parsed.expiry, warnBarcode: a.fromText, note: "",
      });
    }
  } catch (e) {
    toast("읽는 중 문제가 생겼어요: " + errMsg(e));
  } finally {
    unbusy();
  }
  if (r.used) await refresh(false);
  if (!r.cands.length) {
    const msg = [r.used && `${r.used}개 사용 완료 처리`, r.dup && `${r.dup}장은 이미 등록됨`, r.skipped && `${r.skipped}장은 바코드 없음`].filter(Boolean).join(", ");
    toast(msg || "바코드를 찾지 못했어요");
    render();
    return;
  }
  go("review", { review: r });
}

function startEdit() {
  const item = itemById(state.detailId);
  if (!item) return;
  const r = newReview(true);
  r.cands.push({
    key: "e" + item.id, kind: "item", itemId: item.id, imagePath: item.image_path, preview: "",
    brand: item.brand, name: item.name, expiry: item.expires_on, barcode: item.barcode, format: item.barcode_format,
    warnExpiry: false, warnBarcode: false, note: "",
  });
  go("review", { review: r });
  if (item.image_path) {
    sb.storage.from(BUCKET).createSignedUrl(item.image_path, 600).then(({ data }) => {
      if (data && data.signedUrl && state.review === r) {
        r.cands[0].preview = data.signedUrl;
        render();
      }
    });
  }
}

async function dropCand(key) {
  const r = state.review;
  const c = r.cands.find((x) => x.key === key);
  if (!c) return;
  if (c.kind !== "file" && !confirm("이 캡쳐를 지울까요? (기프티콘이 아닌 경우)")) return;
  r.cands = r.cands.filter((x) => x.key !== key);
  if (c.kind === "item") {
    await sb.from("gifticon_items").delete().eq("id", c.itemId);
    await removeImage(c.imagePath);
  } else if (c.kind === "inbox") {
    await sb.from("gifticon_inbox").delete().eq("id", c.inboxId);
    await removeImage(c.imagePath);
  }
  render();
}

async function confirmReview() {
  const r = state.review;
  for (const c of r.cands) {
    c.barcode = gcNormalizeBarcode(c.barcode);
    if (!c.expiry || !c.barcode) {
      toast("유효기간과 바코드 번호를 모두 채워 주세요");
      render();
      return;
    }
  }
  busy("저장 중…");
  let saved = 0;
  const failed = [];
  for (const c of r.cands) {
    const fields = {
      brand: (c.brand || "").trim(),
      name: (c.name || "").trim(),
      expires_on: c.expiry,
      barcode: c.barcode,
      barcode_format: c.format || null,
    };
    try {
      if (c.kind === "item") {
        const { error } = await sb.from("gifticon_items").update({ ...fields, needs_review: false }).eq("id", c.itemId);
        if (error) throw error;
      } else if (c.kind === "inbox") {
        const { error } = await sb.from("gifticon_items").insert({ ...fields, image_path: c.imagePath, source: "shortcut" });
        if (error) throw error;
        await sb.from("gifticon_inbox").delete().eq("id", c.inboxId);
      } else {
        const id = uuid();
        const path = `${state.user.id}/${id}.jpg`;
        const up = await sb.storage.from(BUCKET).upload(path, c.blob, { contentType: "image/jpeg" });
        if (up.error) throw up.error;
        const { error } = await sb.from("gifticon_items").insert({ id, ...fields, image_path: path, source: "manual" });
        if (error) {
          await removeImage(path);
          throw error;
        }
      }
      saved++;
    } catch (e) {
      failed.push(`${c.brand || c.name || c.barcode}: ${errMsg(e)}`);
    }
  }
  unbusy();
  await refresh(false);
  if (failed.length) toast(`저장 못 한 것: ${failed.join(" / ")}`, 4500);
  else toast(r.edit ? "저장했어요" : `${saved}개 등록했어요`);
  if (r.edit) go("detail", { review: null });
  else go("home", { review: null, tab: "available" });
}

/* ================= 알림 ================= */
function b64ToU8(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function swReg() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("sw.js");
  } catch (e) {
    return null;
  }
}

async function syncPush() {
  state.pushOn = false;
  if (!("PushManager" in window) || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  const reg = await swReg();
  if (!reg) return;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  const j = sub.toJSON();
  const { error } = await sb
    .from("gifticon_push_subscriptions")
    .upsert({ user_id: state.user.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth }, { onConflict: "endpoint" });
  state.pushOn = !error;
}

async function enablePush() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    toast(isIOS() ? "홈 화면에 추가한 앱에서 켤 수 있어요" : "이 브라우저는 알림을 지원하지 않아요");
    return;
  }
  const perm = await Notification.requestPermission();
  if (perm !== "granted") {
    toast("알림이 허용되지 않았어요. 아이폰 설정 → 알림에서 허용해 주세요", 4000);
    return;
  }
  busy("알림 켜는 중…");
  try {
    const reg = await swReg();
    await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(VAPID_PUBLIC_KEY) });
    const j = sub.toJSON();
    const { error } = await sb
      .from("gifticon_push_subscriptions")
      .upsert({ user_id: state.user.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth }, { onConflict: "endpoint" });
    if (error) throw error;
    state.pushOn = true;
    toast("알림을 켰어요");
  } catch (e) {
    toast("알림을 켜지 못했어요: " + errMsg(e), 4000);
  } finally {
    unbusy();
    render();
  }
}

async function testPush() {
  const reg = await swReg();
  if (!reg) return;
  await navigator.serviceWorker.ready;
  reg.showNotification("기프티콘함", { body: "알림이 잘 와요! 만료 전에 이렇게 알려드릴게요.", icon: "icon-192.png" });
}

/* ================= 이벤트 ================= */
const actions = {
  toggleAuth() {
    state.authMode = state.authMode === "login" ? "signup" : "login";
    render();
  },
  tab(el) {
    state.tab = el.dataset.tab;
    render();
  },
  openDetail(el) {
    go("detail", { detailId: el.dataset.id });
  },
  home() {
    go("home");
  },
  openSettings() {
    go("settings");
    syncPush().then(() => state.view === "settings" && render());
  },
  startReview() {
    startReview();
  },
  runShortcut() {
    toast("단축어가 끝나면 이 앱으로 돌아와 주세요", 4000);
    setTimeout(() => {
      location.href = "shortcuts://run-shortcut?name=" + encodeURIComponent(SHORTCUT_NAME);
    }, 300);
  },
  closeReview() {
    const back = state.review && state.review.edit ? "detail" : "home";
    go(back, { review: null });
  },
  dropCand(el) {
    dropCand(el.dataset.key);
  },
  confirmReview() {
    confirmReview();
  },
  editItem() {
    startEdit();
  },
  async toggleUsed() {
    const item = itemById(state.detailId);
    if (!item) return;
    const used_at = item.used_at ? null : new Date().toISOString();
    const { error } = await sb.from("gifticon_items").update({ used_at, needs_review: false }).eq("id", item.id);
    if (error) return toast(errMsg(error));
    item.used_at = used_at;
    item.needs_review = false;
    toast(used_at ? "사용 완료로 옮겼어요" : "사용 가능으로 되돌렸어요");
    if (used_at) go("home");
    else render();
  },
  async deleteItem() {
    const item = itemById(state.detailId);
    if (!item || !confirm("이 기프티콘을 삭제할까요?")) return;
    const { error } = await sb.from("gifticon_items").delete().eq("id", item.id);
    if (error) return toast(errMsg(error));
    await removeImage(item.image_path);
    state.items = state.items.filter((i) => i.id !== item.id);
    toast("삭제했어요");
    go("home");
  },
  async viewOriginal() {
    const item = itemById(state.detailId);
    if (!item || !item.image_path) return;
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(item.image_path, 600);
    if (error || !data) return toast("원본을 불러오지 못했어요");
    const v = document.getElementById("viewer");
    v.querySelector("img").src = data.signedUrl;
    v.hidden = false;
  },
  closeViewer() {
    const v = document.getElementById("viewer");
    v.hidden = true;
    v.querySelector("img").removeAttribute("src");
  },
  pickOffset(el) {
    const stage = Number(el.dataset.stage);
    const off = Number(el.dataset.offset);
    const s = state.settings;
    if (stage === 1) {
      const lower = OFFSETS.map((o) => o.id).filter((id) => id < off);
      let second = s.second_offset;
      if (second === null || second === undefined || second >= off) second = lower.length ? lower[0] : null;
      saveSettings({ first_offset: off, second_offset: second });
    } else if (off < s.first_offset) {
      saveSettings({ second_offset: off });
    }
  },
  enablePush() {
    enablePush();
  },
  testPush() {
    testPush();
  },
  async copy(el) {
    try {
      await navigator.clipboard.writeText(el.dataset.value);
      toast("복사했어요");
    } catch (e) {
      prompt("길게 눌러 복사하세요", el.dataset.value);
    }
  },
  async resetToken() {
    if (!confirm("연결 코드를 새로 만들면 단축어에 넣은 코드도 바꿔야 해요. 계속할까요?")) return;
    await saveSettings({ upload_token: uuid() });
    toast("새 연결 코드를 만들었어요");
  },
  async logout() {
    try {
      const reg = await swReg();
      const sub = reg && (await reg.pushManager.getSubscription());
      if (sub) await sb.from("gifticon_push_subscriptions").delete().eq("endpoint", sub.endpoint);
    } catch (e) {}
    await sb.auth.signOut();
  },
};

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.action];
  if (fn) {
    e.preventDefault();
    fn(el, e);
  }
});

document.addEventListener("input", (e) => {
  const el = e.target;
  if (el.dataset.input === "cand" && state.review) {
    const c = state.review.cands.find((x) => x.key === el.dataset.key);
    if (c) {
      c[el.dataset.field] = el.value;
      if (el.dataset.field === "expiry") c.warnExpiry = false;
      if (el.dataset.field === "barcode") c.warnBarcode = false;
    }
  }
});

document.addEventListener("change", (e) => {
  const el = e.target;
  if (el.dataset.change === "pickFiles") {
    const files = el.files;
    handleFiles(files).finally(() => (el.value = ""));
  } else if (el.dataset.change === "time" && el.value) {
    saveSettings({ [el.dataset.field]: el.value });
  }
});

document.addEventListener("submit", async (e) => {
  const form = e.target;
  if (form.dataset.submit !== "auth") return;
  e.preventDefault();
  const email = form.email.value.trim();
  const password = form.password.value;
  busy(state.authMode === "signup" ? "가입하는 중…" : "로그인 중…");
  try {
    if (state.authMode === "signup") {
      const { data, error } = await sb.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: location.origin + location.pathname },
      });
      if (error) throw error;
      if (!data.session) {
        toast("인증 메일을 보냈어요. 메일의 링크를 누른 뒤 로그인해 주세요", 5000);
        state.authMode = "login";
        render();
      }
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
  } catch (err) {
    toast(errMsg(err), 4000);
  } finally {
    unbusy();
  }
});

/* ================= 시작 ================= */
async function refresh(rerender = true) {
  try {
    await loadAll();
  } catch (e) {
    toast("불러오지 못했어요: " + errMsg(e), 4000);
  }
  if (rerender) render();
}

let booted = false;
async function onSignedIn(user) {
  const first = !state.user || state.user.id !== user.id;
  state.user = user;
  if (!first && booted) return;
  booted = true;
  state.settings = null;
  state.view = "loading";
  render();
  await refresh(false);
  syncPush();
  const params = new URLSearchParams(location.search);
  const target = params.get("item");
  if (target && itemById(target)) {
    history.replaceState(null, "", location.pathname);
    go("detail", { detailId: target });
  } else {
    go("home");
  }
}

sb.auth.onAuthStateChange((event, session) => {
  if (session && session.user) {
    setTimeout(() => onSignedIn(session.user), 0);
  } else if (event === "SIGNED_OUT" || event === "INITIAL_SESSION") {
    state.user = null;
    state.items = [];
    state.inbox = [];
    state.settings = null;
    booted = false;
    go("auth");
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.user && (state.view === "home" || state.view === "detail")) {
    refresh(true);
  }
});

swReg();
