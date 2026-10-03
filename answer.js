// עמוד-המענה "מה השאלה?" (23/07, דוקטרינת הדלפק-היחיד): הכפתור השלישי בבית-עלמא.
// המשטח שאסף מנקז בהפסקות, בדרך: מה הכרעת ומה קרה עם זה (רצועת-הקבלות, מקופלת),
// ואז מה השאלה - הממתינים לפי סולם-העדיפויות שהשרת כבר מיין (אדם-מחכה → ריצה-חונה
// → שירות → מכונה; ותק שובר-שוויון בלבד, הכרעת 22/07). אותו לוח-ענן
// (engine-board.json) ואותו inbox של חדר-המכונות - אפס צינור חדש, פנים ממוקדות.
// חדר-המכונות המלא נשאר נגיש בקישור מלמטה.
import { localDecided, rememberDecided, pruneLocalDecided } from "./engine.js";
import { APP_VERSION, toast, micButton, speak } from "./ui.js";
// 16/08 (הכרעת אסף): הדלפק בולע את שלושת המקורות. הספירה של אותו בוקר הראתה
// למה - לוח-המנוע ולוח-השאלות היו ריקים, וכל 16 הממתינים ישבו ב-actions.md,
// המשטח היחיד שאין בו פעלי-מענה. הדלפק אמר "הכל נסגר" ודיווח אמת.
// שלב 2 (03/10/2026): "שאלות אליך". מקור אחד (engine-board.json), פורמט-כרטיס אחד,
// ממוין עוצר-יום ← היום ← שבועי. הכרטיס והידית מיוצאים וחוזרים גם בבית (brief.js).
import { loadAllSources, loadDemoSources, submitAnswer, requestHands, filterSnoozed, snoozeItem, isWeekend } from "./counter.js";
import { getDriveWebUrl, getDrivePathText } from "./graph.js";
import { CONFIG } from "./config.js";

function mk(tag, cls, txt) { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }

function fmtStamp(iso, verb = "עודכן") {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${verb} ${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function titleOf(items, id) {
  const a = (items || []).find((x) => x.id === id);
  return (a && a.title) || null;
}

function receiptRow(r) {
  const row = mk("div", "rcp-row");
  const head = mk("div", "rcp-head");
  head.appendChild(mk("span", "rcp-v " + (r.verdict === "yes" ? "yes" : "no"), r.verdict === "yes" ? "כן" : "לא"));
  head.appendChild(mk("span", "rcp-t", r.title || r.id));
  row.appendChild(head);
  row.appendChild(mk("div", "rcp-st", (r.status || "") + (r.at ? " · " + fmtStamp(r.at, "").trim() : "")));
  if (r.note) row.appendChild(mk("div", "rcp-note", "„" + String(r.note).slice(0, 200) + "”"));
  return row;
}

// רצועת-הקבלות: סוגרת את הלולאה - כל הכרעה מהדהדת חזרה עם "מה קרה עם זה".
// מקופלת כברירת מחדל: המבט הראשון שייך לממתינים, הקבלות במרחק הקשה אחת.
function renderReceipts(receipts, inFlight) {
  const sec = document.createElement("details");
  sec.className = "rcp";
  const n = receipts.length + inFlight.length;
  sec.appendChild(mk("summary", null, "מה הכרעת ומה קרה עם זה · " + n));
  if (!n) { sec.appendChild(mk("div", "card empty", "עוד אין קבלות. הראשונה תופיע מיד אחרי ההכרעה הראשונה שלך.")); return sec; }
  const list = mk("div", "rcp-list");
  inFlight.forEach((r) => list.appendChild(receiptRow(r)));
  receipts.forEach((r) => list.appendChild(receiptRow(r)));
  sec.appendChild(list);
  return sec;
}

const SOURCE_HE = { qboard: "לוח", actions: "פעולות", engine: "מנוע" };

// שורת-המקורות: הדלפק אחד, אבל אסף רואה מאיפה העבודה מגיעה. נגזרת מספירה חיה.
function sourceRow(counts) {
  const row = mk("div", "src-row");
  ["qboard", "actions", "engine"].forEach((k) => {
    row.appendChild(mk("span", "src-pill", `${SOURCE_HE[k]} ${counts[k] || 0}`));
  });
  return row;
}

// ---------- הידית (חוזה §5) ----------
// url: https בלבד, קישור אמיתי (לא window.open אחרי await: חוסם-החלונות בנייד בולע אותו, ראה 28/07 ב-brief.js).
// session: העתקה ללוח. hands: בקשת-מוכנות ל-inbox, הרצה רק בפס. deep: Graph ← webUrl ← טאב חדש.
const HANDLE_DEFAULT = { url: "פתח", session: "העתק טריגר", hands: "הכן למחשב", deep: "פתח" };

export function validHandle(h) {
  if (!h || typeof h !== "object" || typeof h.target !== "string" || !h.target) return null;
  if (h.kind === "url") return /^https:\/\//i.test(h.target) ? h : null;
  if (h.kind === "session") return h;
  if (h.kind === "hands") return /^[a-z0-9-]{2,40}$/.test(h.target) ? h : null;
  if (h.kind === "deep") return /(^|\/)\.\.(\/|$)|^[\\/]|[:*?"<>|\\]/.test(h.target) ? null : h;
  return null;
}

// it: הפריט (id נחוץ ל-hands). ctx: {token, demo}. מחזיר אלמנט או null (בלי ידית תקפה).
export function handleButton(handle, it, ctx, cls) {
  const h = validHandle(handle);
  if (!h) return null;
  const label = h.label || HANDLE_DEFAULT[h.kind];
  const c = ctx || {};
  if (h.kind === "url") {
    const a = mk("a", cls || "btn-ghost qc-handle", label + " ←");
    a.href = h.target; a.target = "_blank"; a.rel = "noopener";
    a.dataset.handle = "url";
    a.style.display = "inline-block"; a.style.textDecoration = "none";
    a.addEventListener("click", (e) => e.stopPropagation());
    return a;
  }
  const b = mk("button", cls || "btn-ghost qc-handle");
  b.type = "button"; b.dataset.handle = h.kind;
  if (h.kind === "session") {
    b.textContent = "📋 " + label;
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      const done = () => toast("הועתק · אמור אותו בסשן חדש");
      const fail = () => toast("העתקה נכשלה · " + h.target);
      try { (navigator.clipboard && navigator.clipboard.writeText(h.target) || Promise.reject()).then(done, fail); }
      catch { fail(); }
    });
  } else if (h.kind === "hands") {
    b.textContent = "הכן למחשב" + (h.label ? " · " + h.label : "");
    b.addEventListener("click", async (e) => {
      e.stopPropagation();
      b.disabled = true;
      const r = await requestHands(it || {}, c);
      if (r.ok) { b.textContent = "יחכה לך בפס ✓"; toast((r.demo ? "מצב הדגמה · " : "") + "הוכן · יחכה לך בפס"); }
      else { b.disabled = false; toast("הבקשה נכשלה · " + r.error); }
    });
  } else {
    b.textContent = label + " ←";
    b.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (c.demo || !c.token) { toast("מצב הדגמה · היה נפתח: " + h.target); return; }
      const w = window.open("about:blank", "_blank");   // נפתח בתוך הלחיצה; הכתובת נטענת אחרי Graph
      try {
        const url = await getDriveWebUrl(c.token, h.target);
        if (!url || !/^https:\/\//i.test(url)) throw new Error("הקובץ לא נמצא ב-OneDrive");
        if (w) { w.opener = null; w.location.href = url; } else location.href = url;
      } catch (err) { if (w) w.close(); toast("הפתיחה נכשלה · " + ((err && err.message) || "")); }
    });
  }
  return b;
}

// ---------- כרטיס "שאלות אליך" (חוזה §6.2) ----------
const DRAFT_KEY = "engine-note-draft";   // אותו מפתח של חדר-המכונות הישן: טיוטות קיימות לא הולכות לאיבוד
function readJSON(key, dflt) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : dflt; } catch { return dflt; } }
function writeJSON(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* storage חסום - לא פטאלי */ } }
function setDraft(id, text) { const m = readJSON(DRAFT_KEY, {}); if (text.trim()) m[id] = text; else delete m[id]; writeJSON(DRAFT_KEY, m); }
function autoGrow(ta) { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; }

function ageText(n) {
  if (!n) return "היום";
  if (n === 1) return "לפני יום";
  return "לפני " + n + " ימים";
}

// it: פריט מנורמל (counter.normalizeEngine). ctx: {token, demo, onSnooze}
export function renderQuestionCard(it, ctx) {
  const c = ctx || {};
  const row = mk("div", "qcard" + (it.urgency === "stop" ? " stop" : "") + (it.exceptional ? " exc" : ""));
  row.dataset.id = it.id; row.dataset.origin = it.origin || "";

  const meta = mk("div", "qc-meta");
  meta.appendChild(mk("span", "qc-topic", [it.topic, ageText(it.ageDays)].filter(Boolean).join(" · ")));
  if (it.exceptional) meta.appendChild(mk("span", "qc-tag exc", "חריג"));
  row.appendChild(meta);

  row.appendChild(mk("div", "qc-q", it.question || it.title));
  if (it.background) row.appendChild(mk("div", "qc-bg", it.background));

  const controls = [];   // כל מה שנעלם אחרי שליחה
  const buttons = [];    // כל מה שננעל בזמן שליחה
  const ta = mk("textarea", "ta-remark ta-grow"); ta.placeholder = "תשובה חופשית, או הערה לאות שתבחר…"; ta.rows = 1;
  const d0 = readJSON(DRAFT_KEY, {}); if (d0[it.id]) ta.value = d0[it.id];
  ta.addEventListener("input", () => { autoGrow(ta); setDraft(it.id, ta.value); });

  function markSent(label, note) {
    controls.forEach((e) => e.remove());
    row.classList.add("sent");
    row.appendChild(mk("span", "locked-tag", (c.demo ? "מצב הדגמה · " : "") + "נשלח · יורד בעדכון הבא"
      + (label ? " · " + label : "") + (note ? " · ההערה שלך: " + note : "")));
  }

  async function send(answer, label) {
    const note = (answer.note || "").trim();
    if (answer.kind === "text" && !note) { toast("כתוב תשובה לפני שליחה"); return; }
    buttons.forEach((b) => { b.disabled = true; });
    if (!c.demo) {
      const res = await submitAnswer(it, { ...answer, note }, c);
      if (!res.ok) { buttons.forEach((b) => { b.disabled = false; }); toast("שליחת התשובה נכשלה · " + (res.error || "")); return; }
      rememberDecided(it.id, { verdict: answer.kind === "text" ? "note" : answer.kind, option: answer.option || "", note, at: new Date().toISOString() });
    }
    setDraft(it.id, "");
    markSent(label, note);
    toast((c.demo ? "מצב הדגמה · " : "") + "נשלח" + (label ? ": " + label : ""));
  }

  // אותיות: נגיעה = שליחה, עם הטקסט שבתיבה כהערה. ★ = מומלצת.
  if (it.options && it.options.length) {
    const opts = mk("div", "eng-opts"); controls.push(opts);
    it.options.forEach((o) => {
      const key = o.key || "", label = o.label || "";
      const text = [key, label].filter(Boolean).join(" · ");
      const b = mk("button", "opt" + (o.recommended ? " rec" : ""), (o.recommended ? "★ " : "") + text);
      b.type = "button"; b.dataset.key = key;
      b.addEventListener("click", () => send({ kind: "option", option: key, optionLabel: label, note: ta.value }, text));
      buttons.push(b); opts.appendChild(b);
    });
    row.appendChild(opts);
  }

  // תשובה חופשית: מוסתרת מאחורי כפתור משני בשורה התחתונה. הטקסט שבתיבה עדיין מצטרף כהערה ללחיצת-אות.
  const freeBox = mk("div", "qc-free"); freeBox.hidden = true; controls.push(freeBox);
  freeBox.appendChild(ta);
  setTimeout(() => autoGrow(ta), 0);
  freeBox.appendChild(micButton(ta));
  const free = mk("button", "iconbtn qc-send", "שלח"); free.type = "button";
  free.addEventListener("click", () => send({ kind: "text", note: ta.value }, "תשובה חופשית"));
  buttons.push(free); freeBox.appendChild(free);
  row.appendChild(freeBox);
  if (ta.value) freeBox.hidden = false;   // טיוטה קיימת נשארת גלויה

  const foot = mk("div", "eng-defer qc-foot"); controls.push(foot);
  const defer = mk("button", "iconbtn", "לא עכשיו"); defer.type = "button";
  defer.title = "יחזור מחר ב-07:00";
  defer.addEventListener("click", () => {
    snoozeItem(it.id);
    row.classList.add("snoozed-out");
    setTimeout(() => { row.remove(); if (c.onSnooze) c.onSnooze(); }, 180);
  });
  buttons.push(defer); foot.appendChild(defer);
  const toggle = mk("button", "iconbtn qc-toggle", "✎ תשובה חופשית"); toggle.type = "button";
  toggle.addEventListener("click", () => { freeBox.hidden = !freeBox.hidden; if (!freeBox.hidden) { autoGrow(ta); ta.focus(); } });
  foot.appendChild(toggle);
  const tts = mk("button", "iconbtn qc-tts", "🔊"); tts.type = "button"; tts.title = "הקרא לי"; tts.setAttribute("aria-label", "הקרא לי");
  tts.addEventListener("click", () => speak([it.question || it.title, it.background].filter(Boolean).join(". ")));
  foot.appendChild(tts);
  const hb = handleButton(it.handle, it, c);
  if (hb) foot.appendChild(hb);
  row.appendChild(foot);
  return row;
}

// קבוצות לפי topic: סדר הקבוצות לפי הפריט הוותיק בה; בתוך קבוצה ageDays יורד.
function groupByTopic(items) {
  const groups = new Map();
  items.forEach((it, i) => {
    const k = it.topic || "";
    if (!groups.has(k)) groups.set(k, { topic: k, items: [], oldest: -1, first: i });
    const g = groups.get(k); g.items.push(it); g.oldest = Math.max(g.oldest, it.ageDays || 0);
  });
  return [...groups.values()]
    .sort((a, b) => b.oldest - a.oldest || a.first - b.first)
    .map((g) => ({ topic: g.topic, items: g.items.slice().sort((a, b) => (b.ageDays || 0) - (a.ageDays || 0)) }));
}

function renderGroups(into, items, ctx) {
  groupByTopic(items).forEach((g) => {
    const wrap = mk("div", "qgroup");
    if (g.topic && g.items.length > 1) wrap.appendChild(mk("div", "qgroup-h", g.topic));   // כותרת-קבוצה רק כשיש בה יותר מפריט אחד (הנושא כבר בשורת הכרטיס)
    g.items.forEach((it) => {
      try { wrap.appendChild(renderQuestionCard(it, ctx)); }
      catch (e) { wrap.appendChild(mk("div", "qcard err-msg", "פריט לא תקין בלוח: " + (e.message || ""))); }
    });
    into.appendChild(wrap);
  });
}

function urgencySection(label, items, ctx, cls) {
  const sec = mk("section", "q-sec " + (cls || ""));
  const sh = mk("div", "shead");
  sh.appendChild(mk("span", "over", label)); sh.appendChild(mk("span", "line"));
  sh.appendChild(mk("span", "thr-count", String(items.length)));
  sec.appendChild(sh);
  renderGroups(sec, items, ctx);
  return sec;
}

function foldedSection(summary, items, ctx, cls) {
  const det = document.createElement("details");
  det.className = "q-fold " + (cls || "");
  det.appendChild(mk("summary", null, summary));
  renderGroups(det, items, ctx);
  return det;
}

// ---------- "שאלות אליך" בבית (חוזה §6.3) ----------
// qs = {items} ממוינים (counter.loadAllSources/loadDemoSources). ctx = {token, demo, weekend, onAll}.
export function renderHomeQuestions(qs, ctx) {
  if (!qs) return null;
  const c = ctx || {};
  const decided = c.demo ? {} : localDecided();
  const { visible } = filterSnoozed((qs.items || []).filter((i) => !decided[i.id]));
  const sec = mk("section", "home-q");
  const sh = mk("div", "shead");
  sh.appendChild(mk("span", "over", "שאלות אליך")); sh.appendChild(mk("span", "line"));
  sec.appendChild(sh);
  const pool = visible.filter((i) => i.urgency === "stop" || i.urgency === "today");
  const cardCtx = { token: c.token, demo: c.demo };
  if (c.weekend) {
    // תיקון לשלב 1 (§6.3): בסוף-שבוע רק exceptional, ובלעדיהם שורה אחת.
    const exc = visible.filter((i) => i.exceptional);
    exc.slice(0, 3).forEach((it) => sec.appendChild(renderQuestionCard(it, cardCtx)));
    const rest = visible.length - exc.length;
    if (!exc.length) sec.appendChild(mk("div", "card empty qc-none", "אין דחוף" + (rest ? ` · ${rest} ממתינות לראשון` : "")));
    else if (rest) sec.appendChild(mk("p", "hint", `${rest} ממתינות לראשון`));
    return sec;
  }
  pool.slice(0, 3).forEach((it) => sec.appendChild(renderQuestionCard(it, cardCtx)));
  if (!pool.length) sec.appendChild(mk("div", "card empty qc-none", "אין שאלות שדורשות אותך כרגע ✓"));
  if (pool.length > 3) {
    const all = mk("button", "btn-ghost qc-all", `כל ה-${pool.length} ←`); all.type = "button";
    all.addEventListener("click", () => { if (c.onAll) c.onAll(); else location.hash = "#answer"; });
    sec.appendChild(all);
  }
  return sec;
}

// הבריף נקרא כאן רק בשביל דגל סוף-השבוע (best-effort); נפילה = שעון ירושלים לבדו.
async function briefForWeekend(token, demo) {
  try {
    if (demo) { const r = await fetch("./brief-sample.json", { cache: "no-store" }); return r.ok ? await r.json() : null; }
    const t = await getDrivePathText(token, CONFIG.briefPath);
    return t ? JSON.parse(t) : null;
  } catch { return null; }
}

function renderPage(container, data, token, opts) {
  const demo = !!(opts && opts.demo);
  const weekend = !!(opts && opts.weekend);
  container.innerHTML = "";
  const board = data.board || {};

  const head = mk("div", "thr-head");
  head.appendChild(mk("span", "over", "שאלות אליך"));
  head.appendChild(mk("span", "thr-count", fmtStamp(board.updatedAt) || " "));
  container.appendChild(head);

  // מקור שנפל לא מפיל את הדלפק: מה שנטען מוצג, ומה שלא נאמר במפורש.
  if (data.failed && data.failed.length) {
    container.appendChild(mk("p", "err-msg pad", "לא נטענו: " + data.failed.join(" · ") + " · השאר מוצג למטה"));
  }

  // הכרעות שנשלחו מהמכשיר הזה וטרם חזרו בלוח-הענן - קבלות-בדרך, לא כרטיס פתוח
  const decided = demo ? {} : localDecided();
  if (!demo && !(data.failed && data.failed.length)) pruneLocalDecided(new Set((data.items || []).map((i) => i.id)));
  const cloudReceiptIds = new Set((board.receipts || []).map((r) => r.id));
  const inFlight = Object.entries(decided)
    .filter(([id]) => !cloudReceiptIds.has(id))
    .map(([id, d]) => ({ id, title: titleOf(data.items, id) || id, verdict: d.verdict, note: d.note, at: d.at, status: "נשלח מהמכשיר, ממתין ללוח" }));

  const rerender = () => renderPage(container, data, token, opts);
  const ctx = { token, demo, onSnooze: rerender };
  const { visible, snoozed } = filterSnoozed((data.items || []).filter((i) => !decided[i.id]));

  const stop = visible.filter((i) => i.urgency === "stop");
  const today = visible.filter((i) => i.urgency === "today");
  const week = visible.filter((i) => i.urgency === "week");

  if (weekend) {
    // סוף-שבוע (§6.2): רק exceptional, ומתחתם "N ממתינות לראשון" מקופל.
    const exc = visible.filter((i) => i.exceptional);
    const rest = visible.filter((i) => !i.exceptional);
    if (exc.length) container.appendChild(urgencySection("עוצר-יום", exc, ctx, "q-stop"));
    else container.appendChild(mk("div", "card empty", "אין דחוף"));
    if (rest.length) container.appendChild(foldedSection(`${rest.length} ממתינות לראשון`, rest, ctx, "q-week"));
  } else {
    if (stop.length) container.appendChild(urgencySection("עוצר-יום", stop, ctx, "q-stop"));
    if (today.length) container.appendChild(urgencySection("היום", today, ctx, "q-today"));
    if (!stop.length && !today.length) {
      container.appendChild(mk("div", "card empty", snoozed
        ? `אין מה לענות כרגע. ${snoozed} נדחו להיום ויחזרו מחר בבוקר.`
        : "אין שאלות שדורשות אותך היום. ✓"));
    }
    if (week.length) container.appendChild(foldedSection(`שבועי · ${week.length} · לישיבת ראשון`, week, ctx, "q-week"));
  }
  if (snoozed && (stop.length || today.length || weekend)) container.appendChild(mk("p", "hint", `${snoozed} נדחו להיום · יחזרו מחר ב-07:00`));

  // רצועת-הקבלות נשארת מקופלת בתחתית, ללא שינוי (§6.2 [פ16]).
  container.appendChild(renderReceipts(board.receipts || [], inFlight));

  const foot = mk("p", "hint");
  const a = mk("a", null, "חדר המכונות המלא ←"); a.href = "#engine";
  foot.appendChild(a);
  // באדג'-גרסה (25/07): הופך את "האם התיקון הגיע לטלפון" מניחוש לבדיקה בהצצה.
  foot.appendChild(mk("span", null, " · " + APP_VERSION));
  container.appendChild(foot);
  if (demo) container.appendChild(mk("p", "hint", "מצב הדגמה - שינויים מקומיים בלבד, ללא כתיבה ל-OneDrive."));
}

// ---------- live ----------
export async function loadAnswer(token, container) {
  container.innerHTML = "";
  container.appendChild(mk("p", "muted pad", "טוען את השאלות…"));
  let data, brief;
  try { [data, brief] = await Promise.all([loadAllSources(token), briefForWeekend(token, false)]); }
  catch (e) {
    container.innerHTML = "";
    container.appendChild(mk("p", "err-msg pad", "שגיאת טעינה: " + ((e && e.message) || "שגיאה לא ידועה")));
    return;
  }
  renderPage(container, data, token, { demo: false, weekend: isWeekend(brief) });
}

// ---------- demo (no auth) ----------
// שלב 2 (§6.9): הדגמה = engine-board-sample.json. DEMO_DATA_LEGACY נשאר בקובץ, לא בשימוש.
const DEMO_DATA_LEGACY = { board: { receipts: [] }, items: [], counts: {}, failed: [] };
export async function loadAnswerDemo(container) {
  container.innerHTML = "";
  container.appendChild(mk("p", "muted pad", "טוען הדגמה…"));
  try {
    const [data, brief] = await Promise.all([loadDemoSources(), briefForWeekend(null, true)]);
    renderPage(container, data, null, { demo: true, weekend: isWeekend(brief) });
  } catch {
    container.innerHTML = "";
    container.appendChild(mk("p", "err-msg pad", "הדגמה לא זמינה"));
  }
}
