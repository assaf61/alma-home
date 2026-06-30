// בית עלמא controller: auth state, hash routing, page rendering, live counters.
// Live mode (signed in) fetches everything from the user's private OneDrive via
// Graph. Not signed in -> a login gate, plus a demo button so the UI can be
// inspected locally without an interactive Microsoft login.
import { initAuth, account, signIn, getToken, configured } from "./auth.js";
import { renderBrief, loadBriefData, loadSampleData } from "./brief.js";
import { loadThreads, loadThreadsDemo } from "./threads.js";
import { loadCapture, loadCaptureDemo } from "./capture.js";
import { loadQuestions, loadQuestionsDemo, countOpenQuestions, listOpenQuestions } from "./questions.js";
import { loadActions, loadActionsDemo, countWaitingActions, listWaitingActions } from "./actions.js";
import { listInbox, getDrivePathText, putDrivePathText } from "./graph.js";
import { toast } from "./ui.js";
import { CONFIG } from "./config.js";

const pages = {
  home: document.getElementById("page-home"),
  capture: document.getElementById("page-capture"),
  threads: document.getElementById("page-threads"),
  questions: document.getElementById("page-questions"),
  actions: document.getElementById("page-actions"),
};

const HS = { questions: "שאלות פתוחות", actions: "ממתין לך", threads: "חוטים" };
const BRIEF_SEEN_KEY = "alma-brief-seen";

function mk(tag, cls, txt) { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }

function setAuthChip() {
  const chip = document.getElementById("chip-auth");
  if (account()) { chip.textContent = "מחובר"; chip.classList.add("ok"); }
  else { chip.textContent = "התחבר"; chip.classList.remove("ok"); }
}

function showPage(route) {
  Object.entries(pages).forEach(([k, el]) => el.classList.toggle("active", k === route));
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.route === route));
  window.scrollTo(0, 0);
}

function loginGate(container, onDemo) {
  container.innerHTML = "";
  const gate = mk("div", "gate");
  const img = mk("img"); img.src = "./alma-mark.png"; img.alt = "עלמא"; gate.appendChild(img);
  gate.appendChild(mk("p", "over", "בית עלמא"));
  gate.appendChild(mk("h1", "gate-h1", "ברוך הבא, אסף"));
  gate.appendChild(mk("p", "muted", "התחבר עם חשבון Microsoft שלך כדי לראות את הבריף והחוטים."));
  const login = mk("button", "btn-primary", "התחבר עם Microsoft");
  login.addEventListener("click", () => signIn());
  gate.appendChild(login);
  const demo = mk("button", "btn-ghost", "צפה בהדגמה");
  demo.addEventListener("click", onDemo);
  gate.appendChild(demo);
  if (!configured()) gate.appendChild(mk("p", "err-msg", "אזהרה: clientId לא מוגדר."));
  container.appendChild(gate);
}

async function gotoThreads() { location.hash = "#threads"; }

// jbwv (ב): on-demand narrative refresh. Writes a flag to OneDrive; the local PC
// watcher runs the brief daemon (~1-3 min, pay-per-use) and writes a fresh body.
// We poll body_built_at and re-render home when it changes. Pure on-press; no
// idle cost. statusCb(msg, done) drives the button label/status text.
function refreshNarrative(statusCb) {
  (async () => {
    const token = await getToken();
    if (!token) { statusCb("התחבר תחילה", true); return; }
    let before = "";
    try { const d0 = await loadBriefData(token); before = (d0 && d0.body_built_at) || ""; } catch { /* ignore */ }
    try {
      const nonce = Date.now() + "-" + Math.random().toString(36).slice(2);
      await putDrivePathText(token, CONFIG.refreshFlagPath,
        JSON.stringify({ requested_at: new Date().toISOString(), nonce }));
    } catch { statusCb("שגיאה בשליחת הבקשה — נסה שוב", true); return; }
    statusCb("מרענן נרטיב… (עד ~2-3 דק')", false);
    const start = Date.now();
    const timer = setInterval(async () => {
      if (Date.now() - start > 5 * 60 * 1000) { clearInterval(timer); statusCb("לקח יותר מהצפוי — בדוק שוב בעוד רגע", true); return; }
      let d = null;
      try { d = await loadBriefData(token); } catch { /* keep polling */ }
      if (d && d.body_built_at && d.body_built_at !== before) {
        clearInterval(timer);
        statusCb("רוענן ✓", true);
        renderHome();
      }
    }, 15000);
  })();
}

// ---------- phoe: landing-page counter strip + bottom-nav badges + new-brief dot ----------
function statusStrip() {
  const s = mk("div", "home-status");
  ["questions", "actions", "threads"].forEach((r) => {
    const chip = mk("button", "hs-chip"); chip.type = "button"; chip.dataset.r = r;
    chip.appendChild(mk("span", "hs-n", "·"));
    chip.appendChild(mk("span", "hs-l", HS[r]));
    chip.addEventListener("click", () => { location.hash = "#" + r; });
    s.appendChild(chip);
  });
  return s;
}

function setBadge(route, n) {
  const btn = document.querySelector(`.nav-btn[data-route="${route}"]`);
  if (!btn) return;
  let b = btn.querySelector(".nav-badge");
  if (!b) { b = mk("span", "nav-badge"); btn.appendChild(b); }
  if (n > 0) { b.textContent = n > 99 ? "99+" : String(n); b.hidden = false; }
  else { b.hidden = true; }
}

function paintCounts(c) {
  if (!c) return;
  setBadge("questions", c.questions);
  setBadge("actions", c.actions);
  setBadge("threads", c.threads);
  document.querySelectorAll(".home-status .hs-chip").forEach((chip) => {
    const n = c[chip.dataset.r];
    const el = chip.querySelector(".hs-n");
    if (el) el.textContent = (n == null ? "·" : String(n));
    chip.classList.toggle("zero", n === 0);
  });
  const home = document.querySelector('.nav-btn[data-route="home"]');
  if (home) {
    let d = home.querySelector(".nav-dot");
    if (!d) { d = mk("span", "nav-dot"); home.appendChild(d); }
    d.hidden = !c.briefNew;
  }
}

async function loadCounts(token) {
  const c = { questions: null, actions: null, threads: null, briefNew: false };
  const [qText, aText, bText] = await Promise.all([
    getDrivePathText(token, CONFIG.openQuestionsPath).catch(() => ""),
    getDrivePathText(token, CONFIG.actionsPath).catch(() => ""),
    getDrivePathText(token, CONFIG.briefPath).catch(() => ""),
  ]);
  try { c.questions = countOpenQuestions(qText || ""); } catch { c.questions = 0; }
  try { c.actions = countWaitingActions(aText || ""); } catch { c.actions = 0; }
  if (bText) { try { const d = JSON.parse(bText); c.briefNew = !!d.date && d.date !== localStorage.getItem(BRIEF_SEEN_KEY); } catch { /* ignore */ } }
  try {
    const items = await listInbox(token, 50);
    c.threads = items.filter((it) => it.file && /\.md$/i.test(it.name) && it.name !== "commercial-threads.md").length;
  } catch { c.threads = 0; }
  return c;
}

let counts = null;
async function refreshCounts() {
  const token = await getToken();
  if (!token) return;
  try { counts = await loadCounts(token); paintCounts(counts); } catch { /* counts are best-effort */ }
}

// ---------- "המשך מכאן": unified card of everything waiting on you ----------
// Aggregates owner:assaf actions + open questions into ONE card at the top of home,
// so the first thing you see in the morning is what to pick up. Each row jumps to
// its tab; session-type items ("פתח שיחה ואמור: ...") get a 📋 that copies the
// trigger phrase to paste into a new Claude chat (session launcher v1).
const SESSION_RE = /נמשיך|פתח שיחה|אמור[:\s]/;
function triggerOf(text) {
  const q = text.match(/["'״“”„]([^"'״“”„\n]{3,})["'״“”„]/);
  if (q) return q[1].trim();
  const a = text.match(/אמור[:\s]+(.+)$/);
  if (a) return a[1].replace(/["'״“”„]/g, "").trim();
  return text.trim();
}
function copyTrigger(text) {
  const phrase = triggerOf(text);
  const done = () => toast("הטריגר הועתק · פתח צ'אט חדש והדבק");
  const fail = () => toast("העתקה נכשלה · " + phrase);
  try { (navigator.clipboard && navigator.clipboard.writeText(phrase) || Promise.reject()).then(done, fail); }
  catch { fail(); }
}
function resumeRow(item, kind) {
  const isSession = kind === "action" && SESSION_RE.test(item.text);
  const row = mk("button", "resume-item"); row.type = "button";
  row.appendChild(mk("span", "ri-ico", isSession ? "🔁" : (kind === "question" ? "❓" : "⏳")));
  const body = mk("span", "ri-body");
  body.appendChild(mk("span", "ri-txt", item.text.length > 90 ? item.text.slice(0, 88) + "…" : item.text));
  if (item.source) body.appendChild(mk("span", "ri-src", item.source));
  row.appendChild(body);
  if (isSession) {
    row.appendChild(mk("span", "ri-copy", "📋"));
    row.addEventListener("click", () => copyTrigger(item.text));
  } else {
    row.appendChild(mk("span", "ri-arrow", "←"));
    row.addEventListener("click", () => { location.hash = kind === "question" ? "#questions" : "#actions"; });
  }
  return row;
}
function resumeCard(acts, qs) {
  const total = acts.length + qs.length;
  const card = mk("section", "resume");
  const h = mk("div", "shead");
  h.appendChild(mk("span", "over", "המשך מכאן")); h.appendChild(mk("span", "line"));
  h.appendChild(mk("span", "resume-count", total ? String(total) : "✓"));
  card.appendChild(h);
  if (!total) { card.appendChild(mk("div", "card empty", "אין דברים פתוחים שממתינים לך כרגע ✓")); return card; }
  const list = mk("div", "resume-list");
  const MAXN = 7; let shown = 0;
  acts.forEach((a) => { if (shown < MAXN) { list.appendChild(resumeRow(a, "action")); shown++; } });
  qs.forEach((q) => { if (shown < MAXN) { list.appendChild(resumeRow(q, "question")); shown++; } });
  card.appendChild(list);
  if (total > MAXN) {
    const more = mk("button", "btn-ghost", `ועוד ${total - MAXN}… ראה הכל`);
    more.addEventListener("click", () => { location.hash = acts.length >= qs.length ? "#actions" : "#questions"; });
    card.appendChild(more);
  }
  return card;
}
async function prependResume(container, token) {
  try {
    const [aText, qText] = await Promise.all([
      getDrivePathText(token, CONFIG.actionsPath).catch(() => ""),
      getDrivePathText(token, CONFIG.openQuestionsPath).catch(() => ""),
    ]);
    const node = resumeCard(listWaitingActions(aText || ""), listOpenQuestions(qText || ""));
    container.insertBefore(node, container.firstChild);
  } catch { /* best-effort: never block the brief */ }
}
const DEMO_RESUME_ACTS = [
  { text: "המשך תזת המאסטר-קלאס — פתח שיחה ואמור: \"נמשיך את תזת המאסטר-קלאס\"", source: "masterclass" },
  { text: "אישור יועץ להצעת סעיף 7 בחוזה (דוגמה סינתטית)", source: "demo-contract" },
  { text: "פגישת תיאום, חמישי 17:00 ת\"א — מוכן להוספה ליומן", source: "demo-meet" },
];
const DEMO_RESUME_QS = [
  { text: "להפיק מכתב סיכום אחרי פגישת הייעוץ? (דוגמה)", source: "demo-consult" },
];
function prependResumeDemo(container) {
  container.insertBefore(resumeCard(DEMO_RESUME_ACTS, DEMO_RESUME_QS), container.firstChild);
}

async function renderHome() {
  const c = pages.home;
  c.innerHTML = "<p class='muted pad'>טוען בריף…</p>";
  const token = await getToken();
  if (token) {
    try {
      const data = await loadBriefData(token);
      if (data) {
        renderBrief(c, data, { onGotoThreads: gotoThreads, onRefreshNarrative: refreshNarrative });
        c.insertBefore(statusStrip(), c.firstChild);   // phoe: counters on the landing page
        await prependResume(c, token);                 // "המשך מכאן" sits at the very top
        if (data.date) localStorage.setItem(BRIEF_SEEN_KEY, data.date);   // viewing home clears "new"
        paintCounts(counts);
        return;
      }
      c.innerHTML = "";
      c.appendChild(statusStrip());
      const e = mk("div", "card empty");
      e.appendChild(mk("h2", null, "אין בריף להיום עדיין"));
      e.appendChild(mk("p", "muted", "הבריף נוצר בבוקר ע\"י good-morning ונכתב ל-OneDrive. בינתיים אפשר לעבור לחוטים."));
      const go = mk("button", "btn-ghost", "מעבר לחוטים ←");
      go.addEventListener("click", gotoThreads);
      e.appendChild(go);
      c.appendChild(e);
      await prependResume(c, token);                 // "המשך מכאן" even when there is no brief yet
      paintCounts(counts);
      return;
    } catch (err) { c.innerHTML = "<p class='err-msg pad'>שגיאת בריף: " + err.message + "</p>"; return; }
  }
  loginGate(c, async () => {
    c.innerHTML = "<p class='muted pad'>טוען הדגמה…</p>";
    try { renderBrief(c, await loadSampleData(), { demo: true, onGotoThreads: gotoThreads }); prependResumeDemo(c); }
    catch { c.innerHTML = "<p class='err-msg pad'>הדגמה לא זמינה</p>"; }
  });
}

async function renderCapture() {
  const c = pages.capture;
  const token = await getToken();
  if (token) { loadCapture(token, c); return; }
  loginGate(c, () => loadCaptureDemo(c));
}

async function renderThreads() {
  const c = pages.threads;
  c.innerHTML = "<p class='muted pad'>טוען חוטים…</p>";
  const token = await getToken();
  if (token) { await loadThreads(token, c); return; }
  loginGate(c, () => loadThreadsDemo(c));
}

async function renderQuestions() {
  const c = pages.questions;
  c.innerHTML = "<p class='muted pad'>טוען שאלות…</p>";
  const token = await getToken();
  if (token) { await loadQuestions(token, c); return; }
  loginGate(c, () => loadQuestionsDemo(c));
}

async function renderActions() {
  const c = pages.actions;
  c.innerHTML = "<p class='muted pad'>טוען פעולות…</p>";
  const token = await getToken();
  if (token) { await loadActions(token, c); return; }
  loginGate(c, () => loadActionsDemo(c));
}

async function route() {
  const r = (location.hash || "#home").replace("#", "");
  const known = pages[r] ? r : "home";
  showPage(known);
  if (known === "home") await renderHome();
  else if (known === "capture") await renderCapture();
  else if (known === "threads") await renderThreads();
  else if (known === "questions") await renderQuestions();
  else if (known === "actions") await renderActions();
  refreshCounts();   // keep the badges live after every navigation
}

// ry37: keep the app current through the day, not just at the morning brief.
// Refresh counts when the app returns to the foreground and on a slow interval.
// Re-render only the home page (never a page with a form being filled).
function onForeground() {
  refreshCounts();
  const r = (location.hash || "#home").replace("#", "");
  if (r === "home" || r === "") renderHome();
}

async function main() {
  if ("serviceWorker" in navigator) {
    // Self-update (fix 30/06): register-and-forget left installed PWAs stuck on
    // cached code (deploys never reached the phone). Now: reload once when a NEW
    // worker takes control (guarded to first-controlled pages so a first install
    // doesn't reload), and re-check for a new worker on every foreground.
    let swReloading = false;
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (swReloading) return;
        swReloading = true;
        window.location.reload();
      });
    }
    navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).then((reg) => {
      const checkUpdate = () => { try { reg.update(); } catch { /* offline */ } };
      window.addEventListener("focus", checkUpdate);
      document.addEventListener("visibilitychange", () => { if (!document.hidden) checkUpdate(); });
    }).catch(() => {});
  }
  await initAuth();
  setAuthChip();

  document.getElementById("chip-auth").addEventListener("click", () => { if (!account()) signIn(); });
  document.querySelectorAll(".nav-btn").forEach((b) => b.addEventListener("click", () => { location.hash = "#" + b.dataset.route; }));
  window.addEventListener("hashchange", route);

  window.addEventListener("focus", onForeground);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) onForeground(); });
  setInterval(refreshCounts, 45 * 60 * 1000);   // ry37: ~45 min rolling refresh

  await route();
}

main();
