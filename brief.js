// Home page = the morning brief, rendered live.
// The renderer is extracted verbatim-in-spirit from
// skills/good-morning/tools/brief-template.html (renderAll), adapted to:
//   - render into a passed container (not a fixed #app)
//   - drop the inline interactive triage (that is now the dispatcher page);
//     instead show a compact CTA that routes to #threads
//   - take data live (no embedded encrypted payload / forge)
import { CONFIG } from "./config.js";
import { getDrivePathText } from "./graph.js";

const LOGO = "./alma-mark.png";

function mk(tag, cls, txt) { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
function listOf(arr) { const u = document.createElement("ul"); arr.forEach((x) => u.appendChild(mk("li", null, x))); return u; }
function detail(label, node) { const d = document.createElement("details"); d.appendChild(mk("summary", null, label)); d.appendChild(node); return d; }
function sec(over) { const s = mk("section"); const h = mk("div", "shead"); h.appendChild(mk("span", "over", over)); h.appendChild(mk("span", "line")); s.appendChild(h); return s; }
function isTime(s) { return /[0-9].*[:–-]/.test(s); }

// jbwv (חלק א): ברכה לפי שעת היום, מחושבת בכל פתיחה. לוגיקת תצוגה טהורה, בלי LLM, אפס עלות.
// מתרעננת אוטומטית עם renderHome בכל חזרה לפורגראונד (ry37), כך שהברכה תמיד תואמת לשעה.
function greeting() {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return "בוקר טוב";
  if (h >= 12 && h < 18) return "צהריים טובים";
  return "ערב טוב";
}

// Truth-stamp helper (19/06 fix, layer B): format the body-build time for humans.
function fmtStamp(iso) {
  try {
    const dt = new Date(iso), now = new Date();
    const hh = String(dt.getHours()).padStart(2, "0"), mm = String(dt.getMinutes()).padStart(2, "0");
    if (dt.toDateString() === now.toDateString()) return `היום ${hh}:${mm}`;
    return `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")} ${hh}:${mm}`;
  } catch { return String(iso); }
}

// Fetch the live brief JSON from OneDrive. Returns parsed data or null (no brief yet).
export async function loadBriefData(token) {
  const txt = await getDrivePathText(token, CONFIG.briefPath);
  if (!txt) return null;
  return JSON.parse(txt);
}

// Demo data for local development (not committed real data).
export async function loadSampleData() {
  const res = await fetch("./brief-sample.json", { cache: "no-store" });
  if (!res.ok) throw new Error("no sample");
  return res.json();
}

export function renderBrief(container, d, { demo = false, onGotoThreads, onRefreshNarrative } = {}) {
  container.innerHTML = "";
  const app = container;

  // header
  const head = mk("header", "brief-head");
  const g = mk("div", "hgreet");
  const greet = greeting();
  g.appendChild(mk("p", "over", greet));
  const h1 = mk("h1");
  h1.appendChild(document.createTextNode(greet + ", "));
  h1.appendChild(mk("strong", null, "אסף"));
  g.appendChild(h1);
  if (d.date) g.appendChild(mk("p", "muted", d.date));
  if (d.pulse) { const pulse = mk("div", "pulse"); d.pulse.forEach((p) => pulse.appendChild(mk("span", null, p))); g.appendChild(pulse); }
  head.appendChild(g);
  app.appendChild(head);

  if (demo) {
    const banner = mk("div", "demo-banner", "מצב הדגמה · לא מחובר (נתונים סינתטיים)");
    app.appendChild(banner);
  }

  // truth-stamp (19/06 fix, layer B): when was the body last rebuilt, and is it stale?
  // The daemon flags body_stale; we also recompute from age as a client-side backup,
  // so the brief can never silently show yesterday's thinking again.
  {
    const builtAt = d.body_built_at || d.generated_at;
    let stale = d.body_stale === true;
    if (!stale && builtAt) {
      const ageH = (Date.now() - new Date(builtAt).getTime()) / 3.6e6;
      if (isFinite(ageH) && ageH >= 20) stale = true;
    }
    if (builtAt || stale) {
      const stamp = mk("div", "brief-stamp" + (stale ? " stale" : ""));
      stamp.appendChild(mk("span", "bs-when", (stale ? "⚠ הגוף לא רוענן · " : "עודכן · ") + (builtAt ? fmtStamp(builtAt) : "לא ידוע")));
      if (stale) stamp.appendChild(mk("span", "bs-msg", "אמור 'בוקר טוב' לבריף מעודכן."));
      app.appendChild(stamp);
    }
  }

  // jbwv (ב): on-demand narrative refresh. Fires ONLY on press (pay-per-use).
  // The state above (greeting, counts, threads, calendar) is already live & free;
  // this rebuilds the written narrative on demand via the local daemon.
  if (!demo && onRefreshNarrative) {
    const wrap = mk("div", "brief-refresh");
    const btn = mk("button", "btn-ghost refresh-btn"); btn.type = "button";
    btn.textContent = "🔄 רענן נרטיב";
    const status = mk("span", "refresh-status muted");
    btn.addEventListener("click", () => {
      btn.disabled = true; btn.textContent = "מרענן…";
      onRefreshNarrative((msg, done) => {
        status.textContent = msg || "";
        if (done) { btn.disabled = false; btn.textContent = "🔄 רענן נרטיב"; }
      });
    });
    wrap.appendChild(btn); wrap.appendChild(status);
    app.appendChild(wrap);
  }

  // budget banner (19/06): API credit at 80% -> decide on renewal; empty -> body can't self-refresh.
  if (d.credit_low || d.budget_warn) {
    const bd = d.budget || {};
    const b = mk("div", "brief-budget" + (d.credit_low ? " out" : " warn"));
    b.textContent = d.credit_low
      ? "⚠ קרדיט ה-API אזל · הגוף לא יתרענן לבד עד שתחדש"
      : `תקציב ה-API ב-${bd.pct != null ? bd.pct : 80}% ($${bd.spent != null ? bd.spent : "?"} מתוך $${bd.budget != null ? bd.budget : 5}) · החלט על חידוש`;
    app.appendChild(b);
  }

  // today
  if (d.today && d.today.length) {
    let s = sec("היום");
    d.today.forEach((t) => {
      const c = mk("div", "card"); const r = mk("div", "row"); const w = mk("div", "when");
      w.appendChild(isTime(t.when) ? mk("span", "ltr", t.when) : document.createTextNode(t.when));
      r.appendChild(w); r.appendChild(mk("div", "what", t.what)); c.appendChild(r); s.appendChild(c);
    });
    app.appendChild(s);
  }

  // upcoming (heads-up: tomorrow + week ahead; all-day items like birthdays/fasts get advance notice)
  if (d.upcoming && d.upcoming.length) {
    let s = sec("קרוב · ימים הבאים");
    d.upcoming.forEach((u) => {
      const c = mk("div", "card"); const r = mk("div", "row"); const w = mk("div", "when");
      w.appendChild(isTime(u.when) ? mk("span", "ltr", u.when) : document.createTextNode(u.when || ""));
      r.appendChild(w);
      const what = mk("div", "what");
      if (u.day) what.appendChild(mk("strong", null, u.day + " "));
      what.appendChild(document.createTextNode(u.what));
      r.appendChild(what); c.appendChild(r); s.appendChild(c);
    });
    app.appendChild(s);
  }

  // threads CTA (replaces the inline triage; routes to the dispatcher page)
  if (d.threads) {
    const n = d.threads.length;
    const s = sec("חוטים");
    const cta = mk("button", "card cta-card");
    cta.appendChild(mk("span", "cta-num", String(n)));
    cta.appendChild(mk("span", "cta-txt", n ? "חוטים ממתינים למיון" : "ה-inbox נקי"));
    cta.appendChild(mk("span", "cta-arrow", "←"));
    if (onGotoThreads) cta.addEventListener("click", onGotoThreads);
    s.appendChild(cta);
    app.appendChild(s);
  }

  // fronts
  if (d.fronts && d.fronts.length) {
    let s = sec("איפה אנחנו · מה פתוח");
    const fc = mk("div", "card");
    d.fronts.forEach((f) => {
      const nrow = mk("div", "num"); nrow.appendChild(mk("div", "n", String(f.n)));
      const b = mk("div", "b"); const h2 = mk("h2");
      h2.appendChild(document.createTextNode(f.title + " "));
      if (f.asap) h2.appendChild(mk("span", "tag asap", "ASAP"));
      b.appendChild(h2); b.appendChild(mk("div", "muted", f.body));
      if (f.trigger) { const tl = mk("div", "trig-line"); tl.appendChild(mk("span", "tag trig", f.trigger)); b.appendChild(tl); }
      nrow.appendChild(b); fc.appendChild(nrow);
    });
    s.appendChild(fc);
    if (d.frontsNote) s.appendChild(mk("p", "hint", d.frontsNote));
    app.appendChild(s);
  }

  // spotlight
  if (d.spotlight && d.spotlight.length) {
    let s = sec("דחוף · זרקור");
    d.spotlight.forEach((sp) => {
      const c = mk("div", "card"); c.style.borderInlineStart = "3px solid var(--" + sp.tone + ")";
      c.appendChild(mk("h2", null, sp.title)); c.appendChild(mk("div", "muted", sp.body)); s.appendChild(c);
    });
    app.appendChild(s);
  }

  // drill-down cards
  if (d.cards && d.cards.length) {
    let s = sec("פירוט · drill-down");
    d.cards.forEach((o) => {
      const c = mk("div", "card"); c.appendChild(mk("h2", null, o.title)); c.appendChild(mk("div", "phead", o.head));
      if (o.facts && o.facts.length) c.appendChild(listOf(o.facts));
      if (o.numbers && o.numbers.length) c.appendChild(detail("מספרים", listOf(o.numbers)));
      if (o.sources && o.sources.length) c.appendChild(detail("מקורות", listOf(o.sources)));
      if (o.next) c.appendChild(detail("הצעד הבא", mk("div", "dtxt", o.next)));
      if (o.related) c.appendChild(detail("קשור", mk("div", "dtxt", o.related)));
      if (o.trigger) { const t = mk("div", "trig-line"); t.appendChild(mk("span", "tag trig", o.trigger)); c.appendChild(t); }
      s.appendChild(c);
    });
    app.appendChild(s);
  }

  // mail
  if (d.mail) { let s = sec("מייל"); const c = mk("div", "card"); c.appendChild(mk("div", "muted", d.mail)); s.appendChild(c); app.appendChild(s); }

  // services
  if (d.services && d.services.length) {
    let s = sec("שירותים"); const c = mk("div", "card"); const box = mk("div", "muted");
    d.services.forEach((x, i) => { if (i) box.appendChild(document.createElement("br")); box.appendChild(document.createTextNode(x)); });
    c.appendChild(box); s.appendChild(c); app.appendChild(s);
  }

  // do / dont
  if (d.doList || d.dontList) {
    let s = sec("מה כדאי · מה לא כדאי היום");
    const dd = mk("div", "dd");
    const doCol = mk("div", "col do"); doCol.appendChild(mk("h3", null, "כדאי"));
    (d.doList || []).forEach((x) => { const li = mk("li"); li.appendChild(mk("span", "mk", "↑")); li.appendChild(mk("span", null, x)); doCol.appendChild(li); });
    const dontCol = mk("div", "col dont"); dontCol.appendChild(mk("h3", null, "לא כדאי"));
    (d.dontList || []).forEach((x) => { const li = mk("li"); li.appendChild(mk("span", "mk", "×")); li.appendChild(mk("span", null, x)); dontCol.appendChild(li); });
    dd.appendChild(doCol); dd.appendChild(dontCol); s.appendChild(dd); app.appendChild(s);
  }

  app.appendChild(mk("p", "disc", "פחות, אבל טוב יותר"));
}
