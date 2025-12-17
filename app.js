// Job Tracker - localStorage + IndexedDB CV Library

const STORAGE_KEY = "jt_jobs_v1";
const CHECK_KEY = "jt_checklist_v1";
const PROFILE_KEY = "jt_profile_v1";

// -------------------- IndexedDB (CVs) --------------------
const DB_NAME = "JobTrackerDB";
const DB_VERSION = 1;
const STORE_CVS = "cvs";

let db = null;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains(STORE_CVS)) {
        d.createObjectStore(STORE_CVS, { keyPath: "id" });
      }
    };

    req.onsuccess = () => {
      db = req.result;
      resolve();
    };

    req.onerror = () => reject(req.error);
  });
}

function idbPutCv(record) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CVS, "readwrite");
    tx.onerror = () => reject(tx.error);
    const store = tx.objectStore(STORE_CVS);
    const req = store.put(record);
    req.onsuccess = () => resolve(record.id);
    req.onerror = () => reject(req.error);
  });
}

function idbGetAllCvs() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CVS, "readonly");
    tx.onerror = () => reject(tx.error);
    const req = tx.objectStore(STORE_CVS).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function idbGetCv(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CVS, "readonly");
    tx.onerror = () => reject(tx.error);
    const req = tx.objectStore(STORE_CVS).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

function idbDeleteCv(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CVS, "readwrite");
    tx.onerror = () => reject(tx.error);
    const req = tx.objectStore(STORE_CVS).delete(id);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

// -------------------- DOM --------------------
const jobForm = document.getElementById("jobForm");
const jobsEl = document.getElementById("jobs");
const emptyEl = document.getElementById("empty");
const statsEl = document.getElementById("stats");
const actionsBarEl = document.getElementById("actionsBar");

const searchEl = document.getElementById("search");
const filterStatusEl = document.getElementById("filterStatus");
const sortByEl = document.getElementById("sortBy");

const exportBtn = document.getElementById("exportBtn");
const importInput = document.getElementById("importInput");
const clearBtn = document.getElementById("clearBtn");

const checklistBoxes = Array.from(document.querySelectorAll("input[type=checkbox][data-check]"));
const lastUpdatedText = document.getElementById("lastUpdatedText");
const resetChecklistBtn = document.getElementById("resetChecklistBtn");

// Profile DOM
const profileNameEl = document.getElementById("profileName");
const profileEmailEl = document.getElementById("profileEmail");
const saveProfileBtn = document.getElementById("saveProfileBtn");
const profileSavedText = document.getElementById("profileSavedText");

// CV DOM
const cvNameEl = document.getElementById("cvName");
const cvFileEl = document.getElementById("cvFile");
const addCvBtn = document.getElementById("addCvBtn");
const cvListEl = document.getElementById("cvList");
const cvUsedEl = document.getElementById("cvUsed");

// -------------------- State --------------------
let jobs = loadJobs();
let actionMode = null; // null | "followups" | "staleApplied"
let cvsCache = []; // [{id,name,filename,mime,uploadedAt,size}]

// -------------------- Helpers --------------------
function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function fmtDate(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("en-AU", { year: "numeric", month: "short", day: "2-digit" });
  } catch {
    return iso;
  }
}

function parseDate(iso) {
  if (!iso) return null;
  const t = Date.parse(iso + "T00:00:00");
  return Number.isFinite(t) ? t : null;
}

function daysBetween(olderIso, newerIso) {
  const a = parseDate(olderIso);
  const b = parseDate(newerIso);
  if (a === null || b === null) return null;
  return Math.floor((b - a) / (1000 * 60 * 60 * 24));
}

function statusBadgeClass(status) {
  if (status === "Offer") return "good";
  if (status === "Interview") return "warn";
  if (status === "Rejected" || status === "Withdrawn") return "bad";
  return "";
}

function safeText(s) {
  return (s ?? "").toString();
}

function normalizeEmail(v) {
  return (v || "").trim().toLowerCase();
}

function normalizePhone(v) {
  return (v || "").trim().replace(/[^\d+]/g, "");
}

function firstNameLike(name) {
  const n = (name || "").trim();
  if (!n) return "";
  return n.split(/\s+/)[0].trim();
}

function bytesToNice(n) {
  if (!Number.isFinite(n) || n <= 0) return "—";
  const units = ["B","KB","MB","GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(str) {
  return escapeHtml(str).replaceAll("`", "&#096;");
}

// -------------------- Profile --------------------
function loadProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    const p = raw ? JSON.parse(raw) : null;
    if (!p || typeof p !== "object") return { name: "", email: "" };
    return { name: (p.name || ""), email: (p.email || "") };
  } catch {
    return { name: "", email: "" };
  }
}

function saveProfile(p) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
}

function initProfileUI() {
  const p = loadProfile();
  profileNameEl.value = p.name || "";
  profileEmailEl.value = p.email || "";

  saveProfileBtn.addEventListener("click", () => {
    saveProfile({
      name: profileNameEl.value.trim(),
      email: profileEmailEl.value.trim()
    });
    profileSavedText.textContent = `Saved ${new Date().toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" })}`;
    setTimeout(() => (profileSavedText.textContent = ""), 2500);
  });
}

// -------------------- Mailto (uses profile + contact name, no "Re:") --------------------
function buildMailto(email, job) {
  const profile = loadProfile();
  const myName = (profile.name || "").trim();
  const myEmail = (profile.email || "").trim();

  const subjectBase = `${job.title || "Role"}${job.company ? " - " + job.company : ""}`;
  const subject = myName ? `${subjectBase} | ${myName}` : subjectBase;

  const greetName = firstNameLike(job.contactName);
  const greeting = greetName ? `Hi ${greetName},` : "Hi,";

  const signoff = myName ? `\n\nThanks,\n${myName}` : `\n\nThanks,`;

  const body =
`${greeting}

I'm following up regarding the ${job.title || "role"}${job.company ? " at " + job.company : ""}.${signoff}
`;

  const cc = myEmail ? `&cc=${encodeURIComponent(myEmail)}` : "";
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}${cc}`;
}

// -------------------- Jobs storage --------------------
function saveJobs() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
}

function loadJobs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    const arr = Array.isArray(parsed) ? parsed : [];

    // migration defaults
    for (const j of arr) {
      if (typeof j.emailed !== "boolean") j.emailed = false;
      if (typeof j.called !== "boolean") j.called = false;
      if (!("posterEmail" in j)) j.posterEmail = "";
      if (!("posterMobile" in j)) j.posterMobile = "";
      if (!("posterMobileRaw" in j)) j.posterMobileRaw = j.posterMobile || "";
      if (!("createdAt" in j)) j.createdAt = Date.now();
      if (typeof j.notes !== "string") j.notes = j.notes ? String(j.notes) : "";
      if (!("contactName" in j)) j.contactName = "";
      if (!("cvId" in j)) j.cvId = "";
      if (!("cvName" in j)) j.cvName = "";
    }

    return arr;
  } catch {
    return [];
  }
}

// -------------------- Checklist --------------------
function loadChecklist() {
  try {
    const raw = localStorage.getItem(CHECK_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object") return { checks: {}, lastUpdated: null };
    return {
      checks: parsed.checks && typeof parsed.checks === "object" ? parsed.checks : {},
      lastUpdated: parsed.lastUpdated || null
    };
  } catch {
    return { checks: {}, lastUpdated: null };
  }
}

function saveChecklist(state) {
  localStorage.setItem(CHECK_KEY, JSON.stringify(state));
}

function renderChecklist() {
  const state = loadChecklist();
  for (const box of checklistBoxes) {
    const key = box.dataset.check;
    box.checked = Boolean(state.checks[key]);
  }
  lastUpdatedText.textContent = `Last checklist update: ${state.lastUpdated ? fmtDate(state.lastUpdated) : "never"}`;
}

checklistBoxes.forEach((box) => {
  box.addEventListener("change", () => {
    const state = loadChecklist();
    state.checks[box.dataset.check] = box.checked;
    state.lastUpdated = todayISO();
    saveChecklist(state);
    renderChecklist();
    render();
  });
});

resetChecklistBtn.addEventListener("click", () => {
  const state = { checks: {}, lastUpdated: todayISO() };
  saveChecklist(state);
  renderChecklist();
  render();
});

// -------------------- CV Library (IndexedDB) --------------------
async function refreshCvsCache() {
  if (!db) return;
  const all = await idbGetAllCvs();

  cvsCache = all
    .map(r => ({
      id: r.id,
      name: r.name || r.filename || "Untitled CV",
      filename: r.filename || "file",
      mime: r.mime || "application/octet-stream",
      uploadedAt: r.uploadedAt || 0,
      size: r.size || 0
    }))
    .sort((a,b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));

  renderCvUI();
}

function renderCvUI() {
  // dropdown
  cvUsedEl.innerHTML = `<option value="">None</option>`;
  for (const cv of cvsCache) {
    const opt = document.createElement("option");
    opt.value = cv.id;
    opt.textContent = cv.name;
    cvUsedEl.appendChild(opt);
  }

  // list
  cvListEl.innerHTML = "";
  if (!cvsCache.length) {
    cvListEl.innerHTML = `<div class="muted tiny">No CVs yet. Add one above.</div>`;
    return;
  }

  for (const cv of cvsCache) {
    const uploaded = cv.uploadedAt ? new Date(cv.uploadedAt).toLocaleDateString("en-AU", { day:"2-digit", month:"short", year:"numeric" }) : "—";
    const el = document.createElement("div");
    el.className = "cv-item";
    el.innerHTML = `
      <div class="cv-name">
        <strong>${escapeHtml(cv.name)}</strong>
        <span>${escapeHtml(cv.filename)} · ${bytesToNice(cv.size)} · ${uploaded}</span>
      </div>
      <div class="cv-actions">
        <button class="btn small ghost openCvBtn" data-id="${escapeAttr(cv.id)}" type="button">Open</button>
        <button class="btn small ghost dlCvBtn" data-id="${escapeAttr(cv.id)}" type="button">Download</button>
        <button class="btn small danger delCvBtn" data-id="${escapeAttr(cv.id)}" type="button">Delete</button>
      </div>
    `;
    cvListEl.appendChild(el);
  }

  cvListEl.querySelectorAll(".openCvBtn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const rec = await idbGetCv(btn.dataset.id);
      if (!rec) return alert("CV not found.");
      const url = URL.createObjectURL(rec.file);
      window.open(url, "_blank", "noopener,noreferrer");
      // don't revoke immediately; let the tab load it
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    });
  });

  cvListEl.querySelectorAll(".dlCvBtn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const rec = await idbGetCv(btn.dataset.id);
      if (!rec) return alert("CV not found.");
      const url = URL.createObjectURL(rec.file);
      const a = document.createElement("a");
      a.href = url;
      a.download = rec.filename || "cv";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    });
  });

  cvListEl.querySelectorAll(".delCvBtn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const cv = cvsCache.find(c => c.id === id);
      if (!confirm(`Delete CV "${cv?.name || "this CV"}"?`)) return;

      await idbDeleteCv(id);

      // remove references on jobs that used it
      for (const j of jobs) {
        if (j.cvId === id) {
          j.cvId = "";
          j.cvName = "";
        }
      }
      saveJobs();

      await refreshCvsCache();
      render();
    });
  });
}

addCvBtn.addEventListener("click", async () => {
  if (!db) return alert("CV storage not ready (IndexedDB).");
  const file = cvFileEl.files && cvFileEl.files[0];
  if (!file) return alert("Pick a CV file first.");
  const name = (cvNameEl.value || "").trim() || file.name;

  const rec = {
    id: uid(),
    name,
    filename: file.name,
    mime: file.type || "application/octet-stream",
    size: file.size || 0,
    uploadedAt: Date.now(),
    file
  };

  await idbPutCv(rec);

  cvNameEl.value = "";
  cvFileEl.value = "";
  await refreshCvsCache();
});

// -------------------- Form submit (Add job) --------------------
jobForm.addEventListener("submit", (e) => {
  e.preventDefault();

  const title = document.getElementById("title").value.trim();
  const company = document.getElementById("company").value.trim();
  const url = document.getElementById("url").value.trim();

  const contactName = document.getElementById("contactName").value.trim();

  const posterEmail = normalizeEmail(document.getElementById("posterEmail").value);
  const posterMobileRaw = document.getElementById("posterMobile").value.trim();
  const posterMobile = normalizePhone(posterMobileRaw);

  const status = document.getElementById("status").value;
  const appliedDate = document.getElementById("appliedDate").value || todayISO();
  const followUpDate = document.getElementById("followUpDate").value || "";
  const notes = document.getElementById("notes").value.trim();

  const cvId = (cvUsedEl.value || "").trim();
  const cvMeta = cvId ? cvsCache.find(c => c.id === cvId) : null;
  const cvName = cvMeta ? cvMeta.name : "";

  const item = {
    id: uid(),
    title,
    company,
    url,

    contactName,
    posterEmail,
    posterMobile,
    posterMobileRaw,

    cvId,
    cvName,

    emailed: false,
    called: false,

    status,
    appliedDate,
    followUpDate,
    notes,
    createdAt: Date.now()
  };

  jobs.unshift(item);
  saveJobs();

  actionMode = null;
  jobForm.reset();
  document.getElementById("appliedDate").value = todayISO();
  render();
});

// Default applied date to today
document.getElementById("appliedDate").value = todayISO();

// -------------------- Filtering & Sorting --------------------
function getViewJobs() {
  const today = todayISO();
  const todayTs = parseDate(today);

  const q = searchEl.value.trim().toLowerCase();
  const filterStatus = filterStatusEl.value;
  const sortBy = sortByEl.value;

  let out = [...jobs];

  if (actionMode === "followups") {
    out = out.filter(j => {
      const fu = parseDate(j.followUpDate);
      if (fu === null || todayTs === null) return false;
      if (j.status === "Rejected" || j.status === "Withdrawn") return false;
      return fu <= todayTs;
    });
  } else if (actionMode === "staleApplied") {
    out = out.filter(j => {
      if (j.status !== "Applied") return false;
      const d = daysBetween(j.appliedDate, today);
      if (d === null) return false;
      return d >= 10;
    });
  }

  if (filterStatus !== "All") {
    out = out.filter(j => j.status === filterStatus);
  }

  if (q) {
    out = out.filter(j => {
      const hay = `${j.title} ${j.company} ${j.notes} ${j.contactName || ""} ${j.posterEmail || ""} ${j.posterMobileRaw || ""} ${j.cvName || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }

  if (sortBy === "newest") {
    out.sort((a,b) => (b.createdAt || 0) - (a.createdAt || 0));
  } else if (sortBy === "oldest") {
    out.sort((a,b) => (a.createdAt || 0) - (b.createdAt || 0));
  } else if (sortBy === "followupSoon") {
    out.sort((a,b) => {
      const af = parseDate(a.followUpDate);
      const bf = parseDate(b.followUpDate);
      if (af === null && bf === null) return 0;
      if (af === null) return 1;
      if (bf === null) return -1;
      return af - bf;
    });
  }

  return out;
}

function exitActionMode() {
  if (actionMode !== null) actionMode = null;
}

searchEl.addEventListener("input", () => { exitActionMode(); render(); });
filterStatusEl.addEventListener("change", () => { exitActionMode(); render(); });
sortByEl.addEventListener("change", () => { render(); });

// -------------------- Today's actions --------------------
function computeTodaysActions() {
  const today = todayISO();
  const todayTs = parseDate(today);

  const followUpsDue = jobs.filter(j => {
    const fu = parseDate(j.followUpDate);
    if (fu === null || todayTs === null) return false;
    if (j.status === "Rejected" || j.status === "Withdrawn") return false;
    return fu <= todayTs;
  });

  const staleApplied = jobs.filter(j => {
    if (j.status !== "Applied") return false;
    const d = daysBetween(j.appliedDate, today);
    if (d === null) return false;
    return d >= 10;
  });

  const checklist = loadChecklist();
  let profileOverdue = false;
  if (!checklist.lastUpdated) {
    profileOverdue = true;
  } else {
    const d = daysBetween(checklist.lastUpdated, today);
    profileOverdue = d === null ? true : d >= 14;
  }

  return { followUpsDue, staleApplied, profileOverdue };
}

function applyAction(kind) {
  searchEl.value = "";
  filterStatusEl.value = "All";

  if (kind === "followups") {
    actionMode = "followups";
    sortByEl.value = "followupSoon";
  } else if (kind === "staleApplied") {
    actionMode = "staleApplied";
    sortByEl.value = "oldest";
  } else if (kind === "profiles") {
    document.querySelector(".checklist")?.scrollIntoView({ behavior: "smooth", block: "center" });
  } else if (kind === "clear") {
    actionMode = null;
  }

  render();
}

function renderActionsBar() {
  const { followUpsDue, staleApplied, profileOverdue } = computeTodaysActions();

  const fuCount = followUpsDue.length;
  const staleCount = staleApplied.length;

  const modeLabel =
    actionMode === "followups" ? "Viewing: follow-ups due" :
    actionMode === "staleApplied" ? "Viewing: applied 10+ days ago" :
    "";

  const pieces = [];

  pieces.push(`
    <div class="action-pill">
      Follow-ups due: <strong>${fuCount}</strong>
      <button type="button" data-action="followups">View</button>
    </div>
  `);

  pieces.push(`
    <div class="action-pill">
      Applied 10+ days ago: <strong>${staleCount}</strong>
      <button type="button" data-action="staleApplied">View</button>
    </div>
  `);

  pieces.push(`
    <div class="action-pill">
      Profiles overdue: <strong>${profileOverdue ? "Yes" : "No"}</strong>
      <button type="button" data-action="profiles">${profileOverdue ? "Update" : "Check"}</button>
    </div>
  `);

  if (actionMode) {
    pieces.push(`
      <div class="action-pill">
        <strong>${modeLabel}</strong>
        <button type="button" data-action="clear">Clear</button>
      </div>
    `);
  } else {
    pieces.push(`<div class="action-note">Tip: set a follow-up date on each “Applied” role.</div>`);
  }

  actionsBarEl.innerHTML = pieces.join("");

  actionsBarEl.querySelectorAll("button[data-action]").forEach(btn => {
    btn.addEventListener("click", () => applyAction(btn.dataset.action));
  });
}

// -------------------- Render jobs --------------------
function renderStats(view) {
  const counts = {
    total: view.length,
    Saved: 0, Applied: 0, Interview: 0, Offer: 0, Rejected: 0, Withdrawn: 0
  };
  for (const j of view) counts[j.status] = (counts[j.status] || 0) + 1;

  statsEl.innerHTML = `
    <div class="stat"><strong>${counts.total}</strong> shown</div>
    <div class="stat"><strong>${counts.Applied}</strong> applied</div>
    <div class="stat"><strong>${counts.Interview}</strong> interview</div>
    <div class="stat"><strong>${counts.Offer}</strong> offer</div>
    <div class="stat"><strong>${counts.Rejected}</strong> rejected</div>
  `;
}

function renderJobs(view) {
  jobsEl.innerHTML = "";

  if (view.length === 0) {
    emptyEl.style.display = "block";
    return;
  }
  emptyEl.style.display = "none";

  for (const j of view) {
    const badgeClass = statusBadgeClass(j.status);
    const followUp = j.followUpDate ? fmtDate(j.followUpDate) : "—";
    const applied = j.appliedDate ? fmtDate(j.appliedDate) : "—";

    const email = (j.posterEmail || "").trim();
    const phoneDisplay = (j.posterMobileRaw || "").trim();
    const phoneTel = (j.posterMobile || "").trim();
    const contactName = (j.contactName || "").trim();

    const contactBits = [];
    if (contactName) contactBits.push(escapeHtml(contactName));
    if (email) contactBits.push(escapeHtml(email));
    if (phoneDisplay) contactBits.push(escapeHtml(phoneDisplay));

    const contactLine = contactBits.length
      ? `<div>Contact: <strong>${contactBits.join(" · ")}</strong></div>`
      : "";

    const cvLine = j.cvId
      ? `<div>CV used: <strong>${escapeHtml(j.cvName || "CV")}</strong></div>`
      : "";

    const cvBtns = j.cvId ? `
      <button class="btn small ghost openJobCvBtn" data-id="${escapeAttr(j.id)}" type="button">Open CV</button>
      <button class="btn small ghost dlJobCvBtn" data-id="${escapeAttr(j.id)}" type="button">Download CV</button>
    ` : "";

    const emailActionBtn = email ? `
      <button class="btn ghost emailBtn" data-id="${escapeAttr(j.id)}" type="button" ${j.emailed ? "disabled" : ""}>
        ${j.emailed ? "eMailed" : "Send email"}
      </button>` : "";

    const callActionBtn = phoneTel ? `
      <button class="btn ghost callBtn" data-id="${escapeAttr(j.id)}" type="button" ${j.called ? "disabled" : ""}>
        ${j.called ? "Called" : "Call"}
      </button>` : "";

    const el = document.createElement("div");
    el.className = "job";
    el.innerHTML = `
      <div class="job-top">
        <div>
          <h4>${escapeHtml(safeText(j.title))}</h4>
          <div class="company">${escapeHtml(safeText(j.company || ""))}</div>
        </div>
        <div class="badge ${badgeClass}">${escapeHtml(safeText(j.status))}</div>
      </div>

      <div class="job-meta">
        <div>Applied: <strong>${applied}</strong></div>
        <div>Follow-up: <strong>${followUp}</strong></div>
        ${contactLine}
        ${cvLine}
        <div>
          ${j.url ? `<a class="chip" href="${escapeAttr(j.url)}" target="_blank" rel="noreferrer">Open link</a>` : ""}
        </div>
      </div>

      ${j.notes ? `<div class="job-notes">${escapeHtml(j.notes)}</div>` : ""}

      <div class="job-actions">
        <select class="statusSelect" data-id="${escapeAttr(j.id)}">
          ${["Saved","Applied","Interview","Offer","Rejected","Withdrawn"].map(s =>
            `<option value="${s}" ${s === j.status ? "selected" : ""}>${s}</option>`
          ).join("")}
        </select>

        <button class="btn ghost followBtn" data-id="${escapeAttr(j.id)}" type="button">Follow-up +7d</button>
        <button class="btn ghost editNotesBtn" data-id="${escapeAttr(j.id)}" type="button">Edit notes</button>
        <button class="btn ghost editBtn" data-id="${escapeAttr(j.id)}" type="button">Edit</button>
        <button class="btn danger delBtn" data-id="${escapeAttr(j.id)}" type="button">Delete</button>

        ${cvBtns}
        ${emailActionBtn}
        ${callActionBtn}
      </div>
    `;

    jobsEl.appendChild(el);
  }

  jobsEl.querySelectorAll(".statusSelect").forEach(sel => {
    sel.addEventListener("change", () => {
      const id = sel.dataset.id;
      const job = jobs.find(x => x.id === id);
      if (!job) return;
      job.status = sel.value;
      saveJobs();
      render();
    });
  });

  jobsEl.querySelectorAll(".followBtn").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const job = jobs.find(x => x.id === id);
      if (!job) return;

      const base = new Date();
      base.setDate(base.getDate() + 7);
      const yyyy = base.getFullYear();
      const mm = String(base.getMonth() + 1).padStart(2, "0");
      const dd = String(base.getDate()).padStart(2, "0");
      job.followUpDate = `${yyyy}-${mm}-${dd}`;

      saveJobs();
      render();
    });
  });

  jobsEl.querySelectorAll(".editNotesBtn").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const job = jobs.find(x => x.id === id);
      if (!job) return;

      const updated = prompt("Edit notes:", job.notes || "");
      if (updated === null) return;

      job.notes = updated.trim();
      saveJobs();
      render();
    });
  });

  jobsEl.querySelectorAll(".delBtn").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      if (!confirm("Delete this job?")) return;
      jobs = jobs.filter(x => x.id !== id);
      saveJobs();
      render();
    });
  });

  jobsEl.querySelectorAll(".editBtn").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const job = jobs.find(x => x.id === id);
      if (!job) return;

      const newTitle = prompt("Job title:", job.title) ?? job.title;
      const newCompany = prompt("Company/Agency:", job.company || "") ?? (job.company || "");
      const newUrl = prompt("Job link:", job.url || "") ?? (job.url || "");

      const newContactName = prompt("Contact name:", job.contactName || "") ?? (job.contactName || "");
      const newEmail = prompt("Poster email:", job.posterEmail || "") ?? (job.posterEmail || "");
      const newMobile = prompt("Poster mobile:", job.posterMobileRaw || "") ?? (job.posterMobileRaw || "");
      const newApplied = prompt("Applied date (YYYY-MM-DD):", job.appliedDate || "") ?? (job.appliedDate || "");
      const newFollow = prompt("Follow-up date (YYYY-MM-DD):", job.followUpDate || "") ?? (job.followUpDate || "");
      const newNotes = prompt("Notes:", job.notes || "") ?? (job.notes || "");

      job.title = newTitle.trim();
      job.company = newCompany.trim();
      job.url = newUrl.trim();

      job.contactName = newContactName.trim();

      job.posterEmail = normalizeEmail(newEmail);
      job.posterMobileRaw = newMobile.trim();
      job.posterMobile = normalizePhone(job.posterMobileRaw);

      job.appliedDate = newApplied.trim();
      job.followUpDate = newFollow.trim();
      job.notes = newNotes.trim();

      if (!job.posterEmail) job.emailed = false;
      if (!job.posterMobile) job.called = false;

      saveJobs();
      render();
    });
  });

  jobsEl.querySelectorAll(".emailBtn").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const job = jobs.find(x => x.id === id);
      if (!job || !job.posterEmail || job.emailed) return;

      job.emailed = true;
      saveJobs();
      render();

      window.location.href = buildMailto(job.posterEmail, job);
    });
  });

  jobsEl.querySelectorAll(".callBtn").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const job = jobs.find(x => x.id === id);
      if (!job || !job.posterMobile || job.called) return;

      job.called = true;
      saveJobs();
      render();

      window.location.href = `tel:${job.posterMobile}`;
    });
  });

  // Job CV open/download
  jobsEl.querySelectorAll(".openJobCvBtn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const job = jobs.find(x => x.id === btn.dataset.id);
      if (!job || !job.cvId) return;
      if (!db) return alert("CV storage not ready.");
      const rec = await idbGetCv(job.cvId);
      if (!rec) return alert("CV not found (maybe deleted).");

      const url = URL.createObjectURL(rec.file);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    });
  });

  jobsEl.querySelectorAll(".dlJobCvBtn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const job = jobs.find(x => x.id === btn.dataset.id);
      if (!job || !job.cvId) return;
      if (!db) return alert("CV storage not ready.");
      const rec = await idbGetCv(job.cvId);
      if (!rec) return alert("CV not found (maybe deleted).");

      const url = URL.createObjectURL(rec.file);
      const a = document.createElement("a");
      a.href = url;
      a.download = rec.filename || "cv";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    });
  });
}

function render() {
  const view = getViewJobs();
  renderActionsBar();
  renderStats(view);
  renderJobs(view);
}

// -------------------- Export / Import --------------------
exportBtn.addEventListener("click", () => {
  // NOTE: This export does NOT include CV files (IndexedDB blobs).
  const payload = {
    exportedAt: new Date().toISOString(),
    jobs,
    checklist: loadChecklist(),
    profile: loadProfile()
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `job-tracker-export-${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

importInput.addEventListener("change", async () => {
  const file = importInput.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const payload = JSON.parse(text);

    if (payload.jobs && Array.isArray(payload.jobs)) {
      jobs = payload.jobs;

      for (const j of jobs) {
        if (typeof j.emailed !== "boolean") j.emailed = false;
        if (typeof j.called !== "boolean") j.called = false;
        if (!("posterEmail" in j)) j.posterEmail = "";
        if (!("posterMobile" in j)) j.posterMobile = "";
        if (!("posterMobileRaw" in j)) j.posterMobileRaw = j.posterMobile || "";
        if (!("createdAt" in j)) j.createdAt = Date.now();
        if (typeof j.notes !== "string") j.notes = j.notes ? String(j.notes) : "";
        if (!("contactName" in j)) j.contactName = "";
        if (!("cvId" in j)) j.cvId = "";
        if (!("cvName" in j)) j.cvName = "";
      }

      saveJobs();
    }
    if (payload.checklist && typeof payload.checklist === "object") {
      saveChecklist(payload.checklist);
    }
    if (payload.profile && typeof payload.profile === "object") {
      saveProfile({
        name: (payload.profile.name || "").trim(),
        email: (payload.profile.email || "").trim()
      });
      // refresh UI inputs
      const p = loadProfile();
      profileNameEl.value = p.name;
      profileEmailEl.value = p.email;
    }

    actionMode = null;
    renderChecklist();
    render();
    alert("Import complete.");
  } catch (e) {
    alert("Import failed. Make sure it’s a valid export JSON file.");
  } finally {
    importInput.value = "";
  }
});

clearBtn.addEventListener("click", () => {
  if (!confirm("This will delete all tracked jobs. Continue?")) return;
  jobs = [];
  saveJobs();
  actionMode = null;
  render();
});

// -------------------- Init --------------------
(async function init() {
  initProfileUI();
  renderChecklist();

  try {
    await openDb();
    await refreshCvsCache();
  } catch {
    // If IndexedDB fails (rare), the app still works without CV storage.
    cvListEl.innerHTML = `<div class="muted tiny">CV storage unavailable in this browser.</div>`;
  }

  render();
})();
