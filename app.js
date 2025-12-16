// Job Tracker - localStorage MVP

const STORAGE_KEY = "jt_jobs_v1";
const CHECK_KEY = "jt_checklist_v1";

// ---------- DOM ----------
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

// ---------- State ----------
let jobs = loadJobs();
let actionMode = null; // null | "followups" | "staleApplied"

// ---------- Helpers ----------
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
  const ms = b - a;
  return Math.floor(ms / (1000 * 60 * 60 * 24));
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
  // If they type "Karen Lewis", we use "Karen"
  return n.split(/\s+/)[0].trim();
}

// ✅ NO "Re:" and greeting uses Contact name if present
function buildMailto(email, job) {
  const subject = `${job.title || "Role"}${job.company ? " - " + job.company : ""}`;
  const greetName = firstNameLike(job.contactName);
  const greeting = greetName ? `Hi ${greetName},` : "Hi,";

  const body =
`${greeting}

I'm following up regarding the ${job.title || "role"}${job.company ? " at " + job.company : ""}.

Thanks,
`;
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

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
      // ✅ NEW field
      if (!("contactName" in j)) j.contactName = "";
    }

    return arr;
  } catch {
    return [];
  }
}

// ---------- Checklist ----------
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

// ---------- Form ----------
jobForm.addEventListener("submit", (e) => {
  e.preventDefault();

  const title = document.getElementById("title").value.trim();
  const company = document.getElementById("company").value.trim();
  const url = document.getElementById("url").value.trim();

  // ✅ NEW
  const contactName = document.getElementById("contactName").value.trim();

  const posterEmail = normalizeEmail(document.getElementById("posterEmail").value);
  const posterMobileRaw = document.getElementById("posterMobile").value.trim();
  const posterMobile = normalizePhone(posterMobileRaw);

  const status = document.getElementById("status").value;
  const appliedDate = document.getElementById("appliedDate").value || todayISO();
  const followUpDate = document.getElementById("followUpDate").value || "";
  const notes = document.getElementById("notes").value.trim();

  const item = {
    id: uid(),
    title,
    company,
    url,
    contactName,         // ✅ NEW
    posterEmail,
    posterMobile,
    posterMobileRaw,
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

// ---------- Filtering & Sorting ----------
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
      const hay = `${j.title} ${j.company} ${j.notes} ${j.contactName || ""} ${j.posterEmail || ""} ${j.posterMobileRaw || ""}`.toLowerCase();
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

// ---------- Today's actions ----------
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

// ---------- Render ----------
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

  // quick notes edit
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

      // ✅ NEW prompt
      const newContactName = prompt("Contact name:", job.contactName || "") ?? (job.contactName || "");

      const newEmail = prompt("Poster email:", job.posterEmail || "") ?? (job.posterEmail || "");
      const newMobile = prompt("Poster mobile:", job.posterMobileRaw || "") ?? (job.posterMobileRaw || "");
      const newApplied = prompt("Applied date (YYYY-MM-DD):", job.appliedDate || "") ?? (job.appliedDate || "");
      const newFollow = prompt("Follow-up date (YYYY-MM-DD):", job.followUpDate || "") ?? (job.followUpDate || "");
      const newNotes = prompt("Notes:", job.notes || "") ?? (job.notes || "");

      job.title = newTitle.trim();
      job.company = newCompany.trim();
      job.url = newUrl.trim();

      job.contactName = newContactName.trim(); // ✅ NEW

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

  // Send email -> eMailed (no "Re:" and greeting uses contact name)
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

  // Call -> Called
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

function render() {
  const view = getViewJobs();
  renderActionsBar();
  renderStats(view);
  renderJobs(view);
}

renderChecklist();
render();

// ---------- Export / Import ----------
exportBtn.addEventListener("click", () => {
  const payload = {
    exportedAt: new Date().toISOString(),
    jobs,
    checklist: loadChecklist()
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
        if (!("contactName" in j)) j.contactName = ""; // ✅ NEW
      }

      saveJobs();
    }
    if (payload.checklist && typeof payload.checklist === "object") {
      saveChecklist(payload.checklist);
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
