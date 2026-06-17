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

export function renderBrief(container, d, { demo = false, onGotoThreads } = {}) {
  container.innerHTML = "";
  const app = container;

  // header
  const head = mk("header", "brief-head");
  const g = mk("div", "hgreet");
  g.appendChild(mk("p", "over", "בוקר טוב"));
  const h1 = mk("h1");
  h1.appendChild(document.createTextNode("בוקר טוב, "));
  h1.appendChild(mk("strong", null, "אסף"));
  g.appendChild(h1);
  if (d.date) g.appendChild(mk("p", "muted", d.date));
  if (d.pulse) { const pulse = mk("div", "pulse"); d.pulse.forEach((p) => pulse.appendChild(mk("span", null, p))); g.appendChild(pulse); }
  head.appendChild(g);
  const img = mk("img"); img.src = LOGO; img.alt = "עלמא"; head.appendChild(img);
  app.appendChild(head);

  if (demo) {
    const banner = mk("div", "demo-banner", "מצב הדגמה · לא מחובר (נתונים סינתטיים)");
    app.appendChild(banner);
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
