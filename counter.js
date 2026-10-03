// הדלפק היחיד (16/08, הכרעת אסף): שכבת-הנרמול והניתוב.
//
// עד היום היו שלושה משטחי-מענה נפרדים, ורק אחד מהם ידע לענות. הספירה של 16/08
// הראתה את המחיר: engine-board awaiting=0, לוח-השאלות 0, וכל 16 הממתינים יושבים
// ב-actions.md - הקובץ היחיד שאין לו פעלי-מענה. הדלפק אמר "הכל נסגר" באמת.
//
// המודול הזה לא נוגע ב-DOM ולא מרנדר כלום. הוא ממיר את שלושת המבנים הגולמיים
// למודל אחד, ומנתב תשובה חזרה לנתיב-הכתיבה של המקור שממנו היא הגיעה.

import { CONFIG } from "./config.js";
import { getDrivePathText, putDrivePathText } from "./graph.js";
import { splitHead, parseBody, serialize, laneOf } from "./actions.js";
import { listOpenQuestions, answerQuestionCore } from "./questions.js";

const SNOOZE_KEY = "counter-snoozed";   // { [id]: "YYYY-MM-DDTHH:mm" בשעון ירושלים }
const SNOOZE_HOUR = 7;
const DEFAULT_TIER = 3;                 // "שירות" - פריט שלא מצהיר מדרגה לא מתיימר לדעת יותר

// ---------- מזהים ----------

// פריטי actions.md נטולי id: parseBody מחזיר {date, source, text, owner, status}
// והזהות היא מיקום בקובץ. דחייה וסימון-מקומי צריכים מפתח יציב, אז גוזרים אחד.
// מוצהר: עריכת הטקסט משנה את המזהה ולכן מאפסת דחייה. פריט שנוסח מחדש הוא שאלה
// חדשה - אין מנגנון-הגירה, בכוונה.
function hash32(s) {
  let h = 0;
  for (let i = 0; i < (s || "").length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
  return (h >>> 0).toString(36);
}

export function actionKey(it) { return `actions:${it.date}|${it.source}|${hash32(it.text)}`; }
export function qboardKey(q) { return `qboard:${q.source}|${hash32(q.text)}`; }

// ---------- נרמול ----------

function item(o) {
  return {
    id: o.id, origin: o.origin,
    title: o.title || "(ללא כותרת)",
    detail: o.detail || "",
    recommendation: o.recommendation || "",
    options: Array.isArray(o.options) ? o.options : [],
    tier: o.tier || DEFAULT_TIER,
    raw: o.raw,
    // שלב 2 (חוזה §1): שדות הפריט האחד. פריט שלא נושא אותם (לוח ישן) נופל לערכי-ברירת-מחדל.
    question: o.question || "", background: o.background || "",
    urgency: o.urgency || "", exceptional: o.exceptional === true,
    topic: o.topic || "", handle: o.handle || null,
    at: o.at || "", ageDays: typeof o.ageDays === "number" ? o.ageDays : 0, ageTier: o.ageTier,
  };
}

// שלב 2 (חוזה §6.1): כל שדות סעיף 1 עוברים. origin נופל ל-"question"; urgency חסר (לוח ישן)
// נגזר מהמדרגה: tier 1 = עוצר-יום, אחרת היום - כדי שפריט לא ייעלם מאחורי מקטע השבועי המקופל.
export function normalizeEngine(awaiting) {
  return (awaiting || []).map((it) => item({
    id: it.id, origin: it.origin || "question", title: it.title, detail: it.detail,
    recommendation: it.recommendation, options: it.options, tier: it.tier, raw: it,
    question: it.question || it.title, background: it.background,
    urgency: ["stop", "today", "week"].includes(it.urgency) ? it.urgency : (it.tier === 1 ? "stop" : "today"),
    exceptional: it.exceptional, topic: it.topic, handle: it.handle, at: it.at, ageDays: it.ageDays, ageTier: it.ageTier,
  }));
}

export function normalizeActions(items) {
  return (items || []).filter((it) => laneOf(it) === "you").map((it) => item({
    id: actionKey(it), origin: "actions", title: it.text,
    detail: it.result || "", raw: it,
  }));
}

// listOpenQuestions מחזיר {text, source, date}, ואילו נתיב-המענה של עמוד-השאלות
// מצפה ל-{project, platform}. מיישרים כאן, בגבול, ולא בזמן הכתיבה.
export function normalizeQboard(list) {
  return (list || []).map((q) => item({
    id: qboardKey(q), origin: "qboard", title: q.text,
    raw: { project: q.source, date: q.date, platform: "", text: q.text },
  }));
}

// מיון לפי סולם-העדיפויות (הכרעת 22/07): אדם-מחכה → ריצה-חונה → שירות → מכונה.
// Array.sort יציב, ולכן סדר-ההגעה נשמר בתוך אותה מדרגה - זה "ותק שובר-שוויון".
// שלב 2 (חוזה §2, "סינון ומיון"): urgency (stop, today, week) ← tier ← ageDays יורד.
const URGENCY_RANK = { stop: 0, today: 1, week: 2 };
export function mergeAndSort(lists) {
  return [].concat(...(lists || []).filter(Boolean)).sort((a, b) =>
    (URGENCY_RANK[a.urgency] ?? 1) - (URGENCY_RANK[b.urgency] ?? 1)
    || a.tier - b.tier
    || (b.ageDays || 0) - (a.ageDays || 0));
}

// ---------- דחייה ----------
// נשמרת כשעון-קיר של ירושלים ומושווית כמחרוזת. שתי המחרוזות באותו אזור-זמן,
// ולכן השוואה לקסיקוגרפית מדויקת ואין צורך להמיר לרגע-בזמן.

function readJSON(key, dflt) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : dflt; }
  catch { return dflt; }
}
function writeJSON(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* storage מלא/חסום - לא פטאלי */ }
}

function jerusalemNow(d) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const p = {};
  f.formatToParts(d || new Date()).forEach((x) => { p[x.type] = x.value; });
  const hour = p.hour === "24" ? "00" : p.hour;   // en-CA מחזיר 24 בחצות
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(hour), stamp: `${p.year}-${p.month}-${p.day}T${hour}:${p.minute}` };
}

function nextMorning(now) {
  const n = now || jerusalemNow();
  if (n.hour < SNOOZE_HOUR) return `${n.date}T0${SNOOZE_HOUR}:00`;
  const [y, m, d] = n.date.split("-").map(Number);
  const t = new Date(y, m - 1, d + 1);
  const p = (x) => String(x).padStart(2, "0");
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}T0${SNOOZE_HOUR}:00`;
}

export function snoozeItem(id) {
  const m = readJSON(SNOOZE_KEY, {});
  m[id] = nextMorning();
  writeJSON(SNOOZE_KEY, m);
  return m[id];
}

// מסננת נדחים ומנקה תוך כדי מפתחות שזמנם עבר, כדי שהמפה לא תתפח לנצח.
export function filterSnoozed(items) {
  const m = readJSON(SNOOZE_KEY, {});
  const now = jerusalemNow().stamp;
  let changed = false;
  Object.keys(m).forEach((k) => { if (m[k] <= now) { delete m[k]; changed = true; } });
  if (changed) writeJSON(SNOOZE_KEY, m);
  const visible = (items || []).filter((it) => !m[it.id]);
  return { visible, snoozed: (items || []).length - visible.length };
}

// ---------- ניתוב הכתיבה ----------
// answer = { kind: "yes"|"no"|"option"|"text", option?, optionLabel?, note? }

function answerText(answer) {
  const note = (answer.note || "").trim();
  if (answer.kind === "option") {
    const lbl = [answer.option, answer.optionLabel].filter(Boolean).join(" · ");
    return note ? `${lbl} — ${note}` : lbl;
  }
  if (answer.kind === "yes") return note ? `כן — ${note}` : "כן";
  if (answer.kind === "no") return note ? `לא — ${note}` : "לא";
  return note;
}

async function toEngine(it, answer, ctx) {
  // שלב 2 (חוזה §6.1): כל origin מנותב לכאן. טקסט בלבד = verdict "note" (תשובה חופשית שסוגרת);
  // אות = "option". title נוסע לצד-המכונה (שער-המענה וה-brief-settled משתמשים בו).
  const at = new Date().toISOString();
  const verdict = answer.kind === "text" ? "note" : answer.kind;
  const payload = {
    id: it.id, verdict, note: (answer.note || "").trim(), at, src: "phone", title: it.title || "",
  };
  if (answer.kind === "option") { payload.option = answer.option; payload.optionLabel = answer.optionLabel || ""; }
  const fname = `decide-${Date.now()}-${it.id}.json`;
  await putDrivePathText(ctx.token, `${CONFIG.engineInboxPath}/${fname}`, JSON.stringify(payload, null, 2));
  return { ok: true, verdict };
}

// "הכן למחשב" (חוזה §4,§5): בקשת-מוכנות בלבד, לא הרצה. הצד-המכונה לוקח את ה-target מהפריט שלו.
export async function requestHands(it, ctx) {
  if (ctx && ctx.demo) return { ok: true, demo: true };
  try {
    const payload = { kind: "hands-request", id: it.id, at: new Date().toISOString() };
    await putDrivePathText(ctx.token, `${CONFIG.engineInboxPath}/hands-${Date.now()}-${it.id}.json`, JSON.stringify(payload, null, 2));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e && e.message) || "שגיאה לא ידועה" };
  }
}

// מזהה כרטיס-פירוט (חוזה §6.5): card- + 12 תווי-hex ראשונים של sha1 על הכותרת המנורמלת
// (רווחים מכווצים + trim), כמו norm בצד-המכונה.
export async function cardId(title) {
  const norm = String(title || "").replace(/\s+/g, " ").trim();
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(norm));
  const hex = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return "card-" + hex.slice(0, 12);
}

async function toActions(it, answer, ctx) {
  // קריאה-שינוי-כתיבה: טוענים מחדש רגע לפני השמירה ולא נשענים על מה שנטען
  // בפתיחת העמוד. אם הפריט כבר לא שם - המכונה כתבה בינתיים ואנחנו לא דורסים.
  const text = (await getDrivePathText(ctx.token, CONFIG.actionsPath)) || "";
  const { head } = splitHead(text);
  const items = parseBody(splitHead(text).body);
  const target = items.find((x) => actionKey(x) === it.id);
  if (!target) return { ok: false, stale: true, error: "הפריט השתנה במקור · רענן" };

  const txt = answerText(answer);
  target.result = target.result && target.result.trim() ? `${target.result.trim()} · ${txt}` : txt;
  target.status = "done";
  await putDrivePathText(ctx.token, CONFIG.actionsPath, serialize(head, items));
  return { ok: true };
}

async function toQboard(it, answer, ctx) {
  // הנתיב המוכח של עמוד-השאלות (log → archive → הסרה מהפתוחות), בלי פילי-הניתוב.
  // ניתוב-לוולט נשאר בעמוד-השאלות: הוא דורש בחירה, והדלפק הוא מקום של תשובה מהירה.
  await answerQuestionCore(ctx.token, it.raw, answerText(answer), {});
  return { ok: true, routed: false };
}

export async function submitAnswer(it, answer, ctx) {
  if (!answerText(answer) && answer.kind === "text") return { ok: false, error: "צריך תשובה" };
  if (ctx && ctx.demo) return { ok: true, demo: true };
  // toActions/toQboard לא נקראים יותר (שלב 2): הכתיבה לקבצי-המקור היא של המכונה בלבד.
  try {
    return await toEngine(it, answer, ctx);
  } catch (e) {
    return { ok: false, error: (e && e.message) || "שגיאה לא ידועה" };
  }
}

// שורת האותיות מוצגת רק כשיש אופציות. עד 16/08 היא הוסתרה על פריטי engine כי
// צרכן ה-inbox (deskDecision בקופה) קיבל yes/no בלבד וכל ערך אחר עבר להסגר בשקט.
// באותו יום נסגרו שני הקצוות: הגשר כותב את האפשרויות לכרטיס כ-{key,label},
// והקופה מכירה verdict:"option" עם המפתח והתווית. התנאי על המקור מיותר עכשיו.
// סדר-פריסה מחייב: מפעילים קודם את הצד המקבל (guard-server) ורק אחר-כך את האפליקציה.
export function canShowOptions(it) {
  return !!(it.options && it.options.length);
}

// ---------- טעינת המקור האחד ----------
// שלב 2 (חוזה §6.1): רק engine-board.json. actions.md ו-open-questions.md כבר לא נקראים מהטלפון;
// המכונה מפרסמת אותם כפריטים בלוח (guard-server bridgeTick). מקור שנפל מדווח ב-failed.

export async function loadAllSources(token) {
  const failed = [];
  let board = null, items = [];
  try {
    const raw = await getDrivePathText(token, CONFIG.engineBoardPath);
    if (raw == null) failed.push("לוח המנוע (לא נמצא)");
    else { board = JSON.parse(raw); items = mergeAndSort([normalizeEngine(board.awaiting)]); }
  } catch (e) {
    failed.push(e instanceof SyntaxError ? "לוח המנוע (JSON שבור)" : "לוח המנוע");
    board = null; items = [];
  }
  return {
    board: board || { awaiting: [], receipts: [], locked: [] },
    items, counts: countsOf(items), failed,
  };
}

// הדגמה (חוזה §6.9): אותו מבנה, מהקובץ שבתיקיית-האפליקציה.
export async function loadDemoSources() {
  const res = await fetch("./engine-board-sample.json", { cache: "no-store" });
  if (!res.ok) throw new Error("no engine-board-sample");
  const board = await res.json();
  const items = mergeAndSort([normalizeEngine(board.awaiting)]);
  return { board, items, counts: countsOf(items), failed: [] };
}

// מונים (חוזה §6.6): הכל נגזר מהלוח בלבד. questions = stop+today, actions = origin action.
export function countsOf(items) {
  const c = { total: items.length, stop: 0, today: 0, week: 0, questions: 0, actions: 0 };
  items.forEach((i) => {
    if (c[i.urgency] != null) c[i.urgency]++;
    if (i.urgency === "stop" || i.urgency === "today") c.questions++;
    if (i.origin === "action") c.actions++;
  });
  return c;
}

// סוף-שבוע (חוזה §6.2): weekend===true בבריף, או יום ו/ש בשעון ירושלים.
export function isWeekend(brief, now) {
  if (brief && brief.weekend === true) return true;
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jerusalem", weekday: "short" }).format(now || new Date());
  return wd === "Fri" || wd === "Sat";
}
