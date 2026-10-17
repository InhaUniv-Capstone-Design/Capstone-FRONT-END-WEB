const STORAGE_KEY = "yakyeon.patient.accounts";
const SESSION_KEY = "yakyeon.patient.session";

const CONSENT_ITEMS = [
  {
    id: "identity",
    title: "이름, 이메일, 휴대폰 번호, 아이디",
    classification: "개인정보",
    tone: "personal",
    detail: "대리인 앱과 복용자 계정을 연결하려고 이름, 이메일, 휴대폰 번호, 아이디를 사용합니다. 열람 주체는 가입 때 입력한 대리인입니다.",
    refusal: "대리 관리·열람 기능을 사용할 수 없습니다.",
  },
  {
    id: "medication",
    title: "약물명, 복용량, 복용 기간",
    classification: "민감정보",
    tone: "sensitive",
    detail: "약물명, 복용량, 복용 기간은 민감정보입니다. 별도 동의이며, 대리인은 이 범위 안에서만 열람합니다.",
    refusal: "대리 관리·열람 기능을 사용할 수 없습니다.",
  },
  {
    id: "photos",
    title: "처방전·약봉지 사진",
    classification: "민감정보",
    tone: "sensitive",
    detail: "처방전과 약봉지 원본 사진을 수집·전송·보관하는 동의입니다. 대리인은 이 범위 안에서만 사진을 봅니다.",
    refusal: "대리 관리·열람 기능을 사용할 수 없습니다.",
  },
  {
    id: "records",
    title: "복약 시간 및 복약 기록",
    classification: "건강정보 · 민감정보",
    tone: "health",
    detail: "복약 알림과 일정 확인을 위해 복약 시각과 복약 기록을 수집합니다. 대리인은 동의한 기록만 볼 수 있습니다.",
    refusal: "병용 금기 등재만 확인할 수 있습니다.",
  },
  {
    id: "device",
    title: "약통의 열림·버튼·센서 이벤트",
    classification: "건강정보 · 민감정보",
    tone: "health",
    detail: "약통이 열린 시각, 버튼 입력, 센서 이벤트를 수집합니다. 대리인 열람은 연동이 유지되는 동안만 가능합니다.",
    refusal: "약통(하드웨어)을 사용할 수 없습니다.",
  },
  {
    id: "dur",
    title: "DUR 등재 정보",
    classification: "건강 관련 민감정보",
    tone: "review",
    review: true,
    detail: "DUR 등재 정보를 저장하고, 연동된 대리인이 그 범위를 열람합니다.",
    reviewNote: "특정인의 약물 정보와 연결되면 건강 관련 민감정보로 다룰 수 있어, 분류 기준은 검토 중입니다.",
    refusal: "‘복용 관리’ 기능만 사용할 수 있습니다.",
  },
];

const ID_PATTERN = /^[A-Za-z0-9]{6,20}$/;
const NAME_PATTERN = /^[가-힣A-Za-z]{2,20}$/;
const MASTER_ACCOUNT = {
  id: "master01",
  password: "Master1!",
  name: "마스터",
  phone: "01000000000",
  agentId: "agent001",
  relationship: "자녀",
};

document.addEventListener("DOMContentLoaded", async () => {
  await ensureMasterAccount();
  bindPasswordToggles(document);
  bindLogin();
  bindSignup();
  bindConsent();
  window.addEventListener("hashchange", syncRoute);
  syncRoute();
});

async function ensureMasterAccount() {
  if (findAccount(MASTER_ACCOUNT.id)) return;
  const salt = randomSalt();
  const accounts = readAccounts();
  accounts.push({
    id: MASTER_ACCOUNT.id,
    salt,
    passwordHash: await hashPassword(MASTER_ACCOUNT.password, salt),
    name: MASTER_ACCOUNT.name,
    phone: MASTER_ACCOUNT.phone,
    agentId: MASTER_ACCOUNT.agentId,
    relationship: MASTER_ACCOUNT.relationship,
    relationshipNote: "",
    consents: emptyConsents(),
    consentSavedAt: null,
  });
  writeAccounts(accounts);
}

let verifiedPhone = "";
let pendingCode = "";
let codeExpiresAt = 0;
let resendAt = 0;
let codeTimer = null;
let checkedId = "";
let consentBuilt = false;
let toastTimer = null;

function syncRoute() {
  const loggedIn = Boolean(readSession());
  let route = (location.hash || "#/login").replace("#/", "");

  if (loggedIn && route !== "consent") {
    history.replaceState(null, "", "#/consent");
    route = "consent";
  }
  if (!loggedIn && route !== "signup") {
    if (route !== "login") history.replaceState(null, "", "#/login");
    route = route === "signup" ? "signup" : "login";
  }

  document.getElementById("view-login").hidden = route !== "login";
  document.getElementById("view-signup").hidden = route !== "signup";
  document.getElementById("view-consent").hidden = route !== "consent";

  if (route === "login") document.title = "로그인 · 약연";
  if (route === "signup") document.title = "회원가입 · 약연";
  if (route === "consent") {
    document.title = "열람 권한 범위 · 약연";
    enterConsent();
  }
  window.scrollTo(0, 0);
}

function bindLogin() {
  document.getElementById("login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const idInput = document.getElementById("login-id");
    const passwordInput = document.getElementById("login-password");
    const id = idInput.value.trim();
    const password = passwordInput.value;
    clearMsg("login-id-msg");
    clearMsg("login-password-msg");
    clearMsg("login-form-msg");
    idInput.removeAttribute("aria-invalid");
    passwordInput.removeAttribute("aria-invalid");

    let invalid = false;
    if (!id) {
      setMsg("login-id-msg", "아이디를 입력해 주세요.");
      idInput.setAttribute("aria-invalid", "true");
      invalid = true;
    }
    if (!password) {
      setMsg("login-password-msg", "비밀번호를 입력해 주세요.");
      passwordInput.setAttribute("aria-invalid", "true");
      invalid = true;
    }
    if (invalid) return;

    const account = findAccount(id);
    const hash = account ? await hashPassword(password, account.salt) : "";
    if (!account || hash !== account.passwordHash) {
      setMsg("login-form-msg", "아이디 또는 비밀번호가 올바르지 않습니다.");
      passwordInput.setAttribute("aria-invalid", "true");
      return;
    }

    writeSession(account.id);
    passwordInput.value = "";
    location.hash = "#/consent";
  });
}

function bindSignup() {
  const phoneInput = document.getElementById("signup-phone");
  const idInput = document.getElementById("signup-id");
  const passwordInput = document.getElementById("signup-password");
  const confirmInput = document.getElementById("signup-password-confirm");
  const relation = document.getElementById("signup-relation");

  phoneInput.addEventListener("input", () => {
    const digits = digitsOnly(phoneInput.value);
    phoneInput.value = formatPhone(digits);
    if (verifiedPhone && verifiedPhone !== digits) resetPhoneVerification();
    clearMsg("signup-phone-msg");
    phoneInput.removeAttribute("aria-invalid");
  });

  idInput.addEventListener("input", () => {
    if (checkedId && checkedId !== idInput.value.trim()) {
      checkedId = "";
      clearMsg("signup-id-msg");
    }
    idInput.removeAttribute("aria-invalid");
  });

  passwordInput.addEventListener("input", () => {
    updatePasswordRules(passwordInput.value);
    updatePasswordMatch();
    clearMsg("signup-password-msg");
    passwordInput.removeAttribute("aria-invalid");
  });

  confirmInput.addEventListener("input", () => {
    updatePasswordMatch();
    confirmInput.removeAttribute("aria-invalid");
  });

  relation.addEventListener("change", () => {
    document.getElementById("relation-note-field").hidden = relation.value !== "기타";
    clearMsg("signup-relation-msg");
    relation.removeAttribute("aria-invalid");
  });

  document.getElementById("request-code").addEventListener("click", requestCode);
  document.getElementById("confirm-code").addEventListener("click", confirmCode);
  document.getElementById("check-id").addEventListener("click", checkDuplicateId);
  document.getElementById("signup-form").addEventListener("submit", submitSignup);
}

function bindConsent() {
  document.getElementById("logout").addEventListener("click", () => {
    if (isDirty() && !window.confirm("저장하지 않은 변경이 있습니다. 로그아웃할까요?")) return;
    localStorage.removeItem(SESSION_KEY);
    location.hash = "#/login";
    toast("로그아웃했습니다.");
  });

  document.getElementById("save-consent").addEventListener("click", saveConsent);
}

function requestCode() {
  const phoneInput = document.getElementById("signup-phone");
  const digits = digitsOnly(phoneInput.value);
  clearMsg("signup-code-msg");

  if (!isMobilePhone(digits)) {
    setMsg("signup-phone-msg", "휴대폰 번호를 확인해 주세요.");
    phoneInput.setAttribute("aria-invalid", "true");
    return;
  }
  if (Date.now() < resendAt) return;

  pendingCode = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0");
  codeExpiresAt = Date.now() + 3 * 60 * 1000;
  resendAt = Date.now() + 60 * 1000;
  verifiedPhone = "";
  document.getElementById("code-field").hidden = false;
  document.getElementById("signup-code").value = "";
  document.getElementById("demo-code").hidden = false;
  document.getElementById("demo-code-value").textContent = pendingCode;
  setMsg("signup-phone-msg", "인증번호를 화면에 표시했습니다.", true);
  phoneInput.removeAttribute("aria-invalid");
  startCodeTimer();
}

function confirmCode() {
  const codeInput = document.getElementById("signup-code");
  const code = codeInput.value.trim();
  const digits = digitsOnly(document.getElementById("signup-phone").value);

  if (!pendingCode) {
    setMsg("signup-code-msg", "먼저 인증번호를 받아 주세요.");
    return;
  }
  if (Date.now() > codeExpiresAt) {
    pendingCode = "";
    setMsg("signup-code-msg", "인증번호가 만료되었습니다. 다시 받아 주세요.");
    codeInput.setAttribute("aria-invalid", "true");
    return;
  }
  if (!/^\d{6}$/.test(code) || code !== pendingCode) {
    setMsg("signup-code-msg", "인증번호가 일치하지 않습니다.");
    codeInput.setAttribute("aria-invalid", "true");
    return;
  }

  verifiedPhone = digits;
  pendingCode = "";
  document.getElementById("demo-code").hidden = true;
  setMsg("signup-code-msg", "휴대폰 인증을 마쳤습니다.", true);
  setMsg("signup-phone-msg", "인증된 번호입니다.", true);
  codeInput.removeAttribute("aria-invalid");
  stopCodeTimer();
  const requestButton = document.getElementById("request-code");
  requestButton.disabled = false;
  requestButton.textContent = "인증번호 받기";
}

function checkDuplicateId() {
  const input = document.getElementById("signup-id");
  const id = input.value.trim();
  if (!ID_PATTERN.test(id)) {
    checkedId = "";
    setMsg("signup-id-msg", "6~20자의 영문과 숫자로 입력해 주세요.");
    input.setAttribute("aria-invalid", "true");
    return;
  }
  if (findAccount(id)) {
    checkedId = "";
    setMsg("signup-id-msg", "이미 사용 중인 아이디입니다.");
    input.setAttribute("aria-invalid", "true");
    return;
  }
  checkedId = id;
  setMsg("signup-id-msg", "사용할 수 있는 아이디입니다.", true);
  input.removeAttribute("aria-invalid");
}

async function submitSignup(event) {
  event.preventDefault();
  const nameInput = document.getElementById("signup-name");
  const phoneInput = document.getElementById("signup-phone");
  const idInput = document.getElementById("signup-id");
  const passwordInput = document.getElementById("signup-password");
  const confirmInput = document.getElementById("signup-password-confirm");
  const agentInput = document.getElementById("signup-agent");
  const relation = document.getElementById("signup-relation");
  const noteInput = document.getElementById("signup-relation-note");

  const name = nameInput.value.trim();
  const phone = digitsOnly(phoneInput.value);
  const id = idInput.value.trim();
  const password = passwordInput.value;
  const confirm = confirmInput.value;
  const agentId = agentInput.value.trim();
  const relationship = relation.value;
  const relationshipNote = noteInput.value.trim();

  const fields = [nameInput, phoneInput, idInput, passwordInput, confirmInput, agentInput, relation, noteInput];
  fields.forEach((field) => field.removeAttribute("aria-invalid"));
  ["signup-name-msg", "signup-phone-msg", "signup-code-msg", "signup-id-msg", "signup-password-msg", "signup-password-confirm-msg", "signup-agent-msg", "signup-relation-msg", "signup-relation-note-msg"]
    .forEach(clearMsg);

  let firstInvalid = null;
  const fail = (input, msgId, message) => {
    setMsg(msgId, message);
    input.setAttribute("aria-invalid", "true");
    if (!firstInvalid) firstInvalid = input;
  };

  if (!NAME_PATTERN.test(name)) fail(nameInput, "signup-name-msg", "이름은 한글 또는 영문 2~20자로 입력해 주세요.");
  if (!isMobilePhone(phone)) fail(phoneInput, "signup-phone-msg", "휴대폰 번호를 확인해 주세요.");
  else if (verifiedPhone !== phone) fail(phoneInput, "signup-phone-msg", "휴대폰 인증을 마쳐 주세요.");
  if (!ID_PATTERN.test(id)) fail(idInput, "signup-id-msg", "6~20자의 영문과 숫자로 입력해 주세요.");
  else if (checkedId !== id) fail(idInput, "signup-id-msg", "아이디 중복 확인을 해 주세요.");
  else if (findAccount(id)) fail(idInput, "signup-id-msg", "이미 사용 중인 아이디입니다.");
  if (!isStrongPassword(password)) fail(passwordInput, "signup-password-msg", "영문, 숫자, 특수문자를 포함해 8자 이상으로 입력해 주세요.");
  if (password !== confirm) fail(confirmInput, "signup-password-confirm-msg", "비밀번호가 서로 다릅니다.");
  if (!ID_PATTERN.test(agentId)) fail(agentInput, "signup-agent-msg", "대리인 아이디는 6~20자의 영문과 숫자입니다.");
  else if (agentId === id) fail(agentInput, "signup-agent-msg", "본인 아이디는 대리인 아이디로 쓸 수 없습니다.");
  if (!relationship) fail(relation, "signup-relation-msg", "대리인과의 관계를 선택해 주세요.");
  if (relationship === "기타" && !relationshipNote) fail(noteInput, "signup-relation-note-msg", "관계를 입력해 주세요.");

  if (firstInvalid) {
    firstInvalid.focus();
    return;
  }

  const salt = randomSalt();
  const account = {
    id,
    salt,
    passwordHash: await hashPassword(password, salt),
    name,
    phone,
    agentId,
    relationship,
    relationshipNote: relationship === "기타" ? relationshipNote : "",
    consents: emptyConsents(),
    consentSavedAt: null,
  };

  const accounts = readAccounts();
  accounts.push(account);
  if (!writeAccounts(accounts)) return;

  resetSignupForm();
  document.getElementById("login-id").value = id;
  document.getElementById("login-password").value = "";
  location.hash = "#/login";
  toast("가입되었습니다. 로그인해 주세요.");
}

function enterConsent() {
  const account = currentAccount();
  if (!account) return;

  const relation = account.relationship === "기타" && account.relationshipNote
    ? `기타 · ${account.relationshipNote}`
    : account.relationship;
  document.getElementById("consent-title").textContent = `${account.name}님의 열람 범위`;
  document.getElementById("consent-who").textContent = `대리인 ${account.agentId} · ${relation}`;

  if (!consentBuilt) {
    buildConsentCards();
    consentBuilt = true;
  }
  applyConsents(account.consents || emptyConsents());
  updateSummary();
}

function buildConsentCards() {
  const list = document.getElementById("consent-list");
  list.replaceChildren();

  CONSENT_ITEMS.forEach((item) => {
    const card = document.createElement("article");
    card.className = "consent-card is-no";
    card.dataset.item = item.id;

    const badges = document.createElement("div");
    badges.className = "badges";
    badges.append(badge(item.classification, item.tone));
    if (item.review) badges.append(badge("검토 중", "review"));
    card.append(badges);

    const fieldset = document.createElement("fieldset");
    const legend = document.createElement("legend");
    legend.textContent = item.title;
    fieldset.append(legend);

    const detail = document.createElement("p");
    detail.className = "detail";
    detail.textContent = item.detail;
    fieldset.append(detail);

    if (item.reviewNote) {
      const note = document.createElement("p");
      note.className = "review-note";
      note.textContent = item.reviewNote;
      fieldset.append(note);
    }

    const refusal = document.createElement("p");
    refusal.className = "refusal";
    const refusalLabel = document.createElement("span");
    refusalLabel.className = "refusal-label";
    refusalLabel.textContent = "동의하지 않으면";
    const refusalText = document.createElement("span");
    refusalText.className = "refusal-text";
    refusalText.textContent = item.refusal;
    refusal.append(refusalLabel, refusalText);
    fieldset.append(refusal);

    const choice = document.createElement("div");
    choice.className = "choice";
    choice.append(
      radio(item.id, "yes", "동의", "choice-yes"),
      radio(item.id, "no", "비동의", "choice-no", true),
    );
    fieldset.append(choice);
    card.append(fieldset);
    list.append(card);
  });

  list.addEventListener("change", (event) => {
    if (event.target instanceof HTMLInputElement && event.target.name.startsWith("consent-")) {
      updateSummary();
    }
  });
}

function badge(text, tone) {
  const node = document.createElement("span");
  node.className = `badge ${tone}`;
  node.textContent = text;
  return node;
}

function radio(itemId, value, label, className, checked) {
  const wrap = document.createElement("label");
  wrap.className = `choice-opt ${className}`;
  const input = document.createElement("input");
  input.type = "radio";
  input.name = `consent-${itemId}`;
  input.value = value;
  input.checked = Boolean(checked);
  const text = document.createElement("span");
  text.textContent = label;
  wrap.append(input, text);
  return wrap;
}

function applyConsents(consents) {
  CONSENT_ITEMS.forEach((item) => {
    const value = consents[item.id] ? "yes" : "no";
    const input = document.querySelector(`input[name="consent-${item.id}"][value="${value}"]`);
    if (input) input.checked = true;
  });
}

function updateSummary() {
  const consents = currentConsents();
  document.querySelectorAll(".consent-card").forEach((card) => {
    const agreed = Boolean(consents[card.dataset.item]);
    card.classList.toggle("is-yes", agreed);
    card.classList.toggle("is-no", !agreed);
  });

  const summary = document.getElementById("summary");
  const body = document.getElementById("summary-body");
  body.replaceChildren();
  const groups = refusalGroups(consents);

  if (groups.length === 0) {
    summary.classList.add("is-clear");
    const clear = document.createElement("p");
    clear.textContent = "연동된 대리인이 위 정보를 모두 열람할 수 있습니다.";
    body.append(clear);
  } else {
    summary.classList.remove("is-clear");
    groups.forEach((group) => {
      const block = document.createElement("div");
      block.className = "summary-group";
      const items = document.createElement("ul");
      items.className = "summary-items";
      group.titles.forEach((title) => {
        const li = document.createElement("li");
        li.textContent = title;
        items.append(li);
      });
      const refusal = document.createElement("p");
      refusal.className = "summary-refusal";
      refusal.textContent = group.refusal;
      block.append(items, refusal);
      body.append(block);
    });
  }

  const account = currentAccount();
  const savedAt = account && account.consentSavedAt;
  const dirty = isDirty();
  const note = document.getElementById("save-note");
  const button = document.getElementById("save-consent");
  if (!savedAt) {
    note.textContent = "아직 저장하지 않았습니다.";
    button.disabled = false;
    button.textContent = "열람 범위 저장";
  } else if (dirty) {
    note.textContent = "저장되지 않은 변경이 있습니다.";
    button.disabled = false;
    button.textContent = "열람 범위 저장";
  } else {
    note.textContent = `저장됨 · ${formatWhen(savedAt)}`;
    button.disabled = true;
    button.textContent = "저장됨";
  }
}

function saveConsent() {
  const accounts = readAccounts();
  const session = readSession();
  const index = accounts.findIndex((account) => account.id === session);
  if (index < 0) return;

  accounts[index].consents = currentConsents();
  accounts[index].consentSavedAt = new Date().toISOString();
  if (!writeAccounts(accounts)) return;
  updateSummary();
  toast("열람 범위를 저장했습니다.");
}

function currentConsents() {
  const consents = {};
  CONSENT_ITEMS.forEach((item) => {
    const selected = document.querySelector(`input[name="consent-${item.id}"]:checked`);
    consents[item.id] = Boolean(selected && selected.value === "yes");
  });
  return consents;
}

function refusalGroups(consents) {
  const groups = [];
  CONSENT_ITEMS.forEach((item) => {
    if (consents[item.id]) return;
    const found = groups.find((group) => group.refusal === item.refusal);
    if (found) found.titles.push(item.title);
    else groups.push({ refusal: item.refusal, titles: [item.title] });
  });
  return groups;
}

function isDirty() {
  const account = currentAccount();
  if (!account || !consentBuilt) return false;
  const saved = { ...emptyConsents(), ...(account.consents || {}) };
  const current = currentConsents();
  return CONSENT_ITEMS.some((item) => Boolean(saved[item.id]) !== Boolean(current[item.id]));
}

function emptyConsents() {
  return Object.fromEntries(CONSENT_ITEMS.map((item) => [item.id, false]));
}

function resetSignupForm() {
  document.getElementById("signup-form").reset();
  resetPhoneVerification();
  checkedId = "";
  document.getElementById("relation-note-field").hidden = true;
  updatePasswordRules("");
  document.querySelectorAll("#signup-form [aria-invalid]").forEach((node) => node.removeAttribute("aria-invalid"));
  document.querySelectorAll("#signup-form .field-msg").forEach((node) => {
    node.textContent = "";
    node.classList.remove("is-error", "is-ok");
  });
}

function resetPhoneVerification() {
  verifiedPhone = "";
  pendingCode = "";
  codeExpiresAt = 0;
  resendAt = 0;
  stopCodeTimer();
  document.getElementById("code-field").hidden = true;
  document.getElementById("demo-code").hidden = true;
  document.getElementById("signup-code").value = "";
  document.getElementById("request-code").disabled = false;
  document.getElementById("request-code").textContent = "인증번호 받기";
  clearMsg("signup-code-msg");
}

function startCodeTimer() {
  stopCodeTimer();
  tickCodeTimer();
  codeTimer = window.setInterval(tickCodeTimer, 1000);
}

function tickCodeTimer() {
  const button = document.getElementById("request-code");
  const left = Math.ceil((resendAt - Date.now()) / 1000);
  if (left > 0) {
    button.disabled = true;
    button.textContent = `다시 받기 ${left}초`;
    return;
  }
  button.disabled = false;
  button.textContent = "다시 받기";
  if (pendingCode && Date.now() > codeExpiresAt) {
    pendingCode = "";
    setMsg("signup-code-msg", "인증번호가 만료되었습니다. 다시 받아 주세요.");
    stopCodeTimer();
  }
}

function stopCodeTimer() {
  if (codeTimer) window.clearInterval(codeTimer);
  codeTimer = null;
}

function updatePasswordRules(password) {
  const checks = {
    length: password.length >= 8,
    letter: /[A-Za-z]/.test(password),
    digit: /\d/.test(password),
    symbol: /[^A-Za-z0-9]/.test(password),
  };
  document.querySelectorAll("#password-rules li").forEach((item) => {
    item.classList.toggle("is-met", Boolean(checks[item.dataset.rule]));
  });
}

function updatePasswordMatch() {
  const password = document.getElementById("signup-password").value;
  const confirm = document.getElementById("signup-password-confirm").value;
  if (!confirm) {
    clearMsg("signup-password-confirm-msg");
    return;
  }
  setMsg(
    "signup-password-confirm-msg",
    password === confirm ? "비밀번호가 일치합니다." : "비밀번호가 서로 다릅니다.",
    password === confirm,
  );
}

function bindPasswordToggles(root) {
  root.querySelectorAll("[data-toggle-password]").forEach((button) => {
    button.addEventListener("click", () => {
      const input = document.getElementById(button.dataset.togglePassword);
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      button.textContent = show ? "숨김" : "표시";
      button.setAttribute("aria-pressed", String(show));
    });
  });
}

function isMobilePhone(digits) {
  return /^01[016789]\d{7,8}$/.test(digits);
}

function isStrongPassword(password) {
  return password.length >= 8 && /[A-Za-z]/.test(password) && /\d/.test(password) && /[^A-Za-z0-9]/.test(password);
}

function digitsOnly(value) {
  return value.replace(/\D/g, "").slice(0, 11);
}

function formatPhone(digits) {
  const mid = digits.startsWith("010") ? 7 : 6;
  if (digits.length <= 3) return digits;
  if (digits.length <= mid) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, mid)}-${digits.slice(mid)}`;
}

function findAccount(id) {
  return readAccounts().find((account) => account.id === id) || null;
}

function currentAccount() {
  const session = readSession();
  return session ? findAccount(session) : null;
}

function readAccounts() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAccounts(accounts) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts));
    return true;
  } catch {
    toast("이 브라우저에는 계정을 저장할 수 없습니다.");
    return false;
  }
}

function readSession() {
  return localStorage.getItem(SESSION_KEY) || "";
}

function writeSession(id) {
  localStorage.setItem(SESSION_KEY, id);
}

function setMsg(id, message, ok) {
  const node = document.getElementById(id);
  node.textContent = message || "";
  node.classList.toggle("is-error", Boolean(message) && !ok);
  node.classList.toggle("is-ok", Boolean(message) && ok);
}

function clearMsg(id) {
  setMsg(id, "");
}

function formatWhen(iso) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function randomSalt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hashPassword(password, salt) {
  const text = `${salt}:${password}`;
  if (crypto.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function toast(message) {
  const node = document.getElementById("toast");
  node.textContent = message;
  node.classList.add("is-on");
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => node.classList.remove("is-on"), 2400);
}
