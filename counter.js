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
  };
}

export function normalizeEngine(awaiting) {
  return (awaiting || []).map((it) => item({
    id: it.id, origin: "engine", title: it.title, detail: it.detail,
    recommendation: it.recommendation, options: it.options, tier: it.tier, raw: it,
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
export function mergeAndSort(lists) {
  return [].concat(...(lists || []).filter(Boolean)).sort((a, b) => a.tier - b.tier);
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
  // הרחבה תואמת-לאחור: verdict נשאר yes/no לצרכן הקיים, ואות מגיעה כ-"option".
  // כל עוד הצרכן בצד-המכונה לא מכיר את הערך הזה, שורת האותיות מוסתרת על פריטי
  // engine (ראה canShowOptions) - עדיף כפתור שלא קיים מכפתור שנבלע בשקט.
  const at = new Date().toISOString();
  const payload = {
    id: it.id, verdict: answer.kind, note: (answer.note || "").trim(), at, src: "phone",
  };
  if (answer.kind === "option") { payload.option = answer.option; payload.optionLabel = answer.optionLabel || ""; }
  const fname = `decide-${Date.now()}-${it.id}.json`;
  await putDrivePathText(ctx.token, `${CONFIG.engineInboxPath}/${fname}`, JSON.stringify(payload, null, 2));
  return { ok: true, verdict: answer.kind };
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
  try {
    if (it.origin === "engine") return await toEngine(it, answer, ctx);
    if (it.origin === "actions") return await toActions(it, answer, ctx);
    if (it.origin === "qboard") return await toQboard(it, answer, ctx);
    return { ok: false, error: "מקור לא מוכר: " + it.origin };
  } catch (e) {
    return { ok: false, error: (e && e.message) || "שגיאה לא ידועה" };
  }
}

// שורת האותיות מוצגת רק כשיש אופציות וגם הצד השני יודע לקרוא אותן.
// חדר-המכונות המלא מרנדר פריטי-לוח גולמיים בלי origin - ברירת המחדל היא "engine"
// דווקא כדי שהם ייפלו לצד הבטוח ולא יציגו אותיות שייבלעו.
export function canShowOptions(it) {
  return !!(it.options && it.options.length) && (it.origin || "engine") !== "engine";
}

// ---------- טעינת שלושת המקורות ----------
// Promise.allSettled: מקור שנפל לא מפיל את הדלפק. מה שנטען - מוצג.

export async function loadAllSources(token) {
  const [eng, act, qb] = await Promise.allSettled([
    getDrivePathText(token, CONFIG.engineBoardPath),
    getDrivePathText(token, CONFIG.actionsPath),
    getDrivePathText(token, CONFIG.openQuestionsPath),
  ]);

  const failed = [];
  let board = null, engineItems = [], actionItems = [], qboardItems = [];

  if (eng.status === "fulfilled" && eng.value != null) {
    try { board = JSON.parse(eng.value); engineItems = normalizeEngine(board.awaiting); }
    catch { failed.push("לוח המנוע (JSON שבור)"); }
  } else if (eng.status === "rejected") { failed.push("לוח המנוע"); }

  if (act.status === "fulfilled" && act.value != null) {
    try { actionItems = normalizeActions(parseBody(splitHead(act.value).body)); }
    catch { failed.push("נתיב הפעולות"); }
  } else if (act.status === "rejected") { failed.push("נתיב הפעולות"); }

  if (qb.status === "fulfilled" && qb.value != null) {
    try { qboardItems = normalizeQboard(listOpenQuestions(qb.value)); }
    catch { failed.push("לוח השאלות"); }
  } else if (qb.status === "rejected") { failed.push("לוח השאלות"); }

  return {
    board: board || { awaiting: [], receipts: [], locked: [] },
    items: mergeAndSort([engineItems, actionItems, qboardItems]),
    counts: { engine: engineItems.length, actions: actionItems.length, qboard: qboardItems.length },
    failed,
  };
}
