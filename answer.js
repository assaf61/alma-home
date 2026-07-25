// עמוד-המענה "מה השאלה?" (23/07, דוקטרינת הדלפק-היחיד): הכפתור השלישי בבית-עלמא.
// המשטח שאסף מנקז בהפסקות, בדרך: מה הכרעת ומה קרה עם זה (רצועת-הקבלות, מקופלת),
// ואז מה השאלה - הממתינים לפי סולם-העדיפויות שהשרת כבר מיין (אדם-מחכה → ריצה-חונה
// → שירות → מכונה; ותק שובר-שוויון בלבד, הכרעת 22/07). אותו לוח-ענן
// (engine-board.json) ואותו inbox של חדר-המכונות - אפס צינור חדש, פנים ממוקדות.
// חדר-המכונות המלא נשאר נגיש בקישור מלמטה.
import { getDrivePathText } from "./graph.js";
import { CONFIG } from "./config.js";
import { renderAwaitingSection, localDecided } from "./engine.js";
import { APP_VERSION } from "./ui.js";

function mk(tag, cls, txt) { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }

function fmtStamp(iso, verb = "עודכן") {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${verb} ${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function titleOf(board, id) {
  const a = (board.awaiting || []).find((x) => x.id === id);
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

function renderPage(container, board, token, opts) {
  const demo = !!(opts && opts.demo);
  container.innerHTML = "";

  const head = mk("div", "thr-head");
  head.appendChild(mk("span", "over", "מה השאלה?"));
  head.appendChild(mk("span", "thr-count", fmtStamp(board.updatedAt) || " "));
  container.appendChild(head);

  // הכרעות שנשלחו מהמכשיר הזה וטרם חזרו בלוח-הענן - קבלות-בדרך, לא כרטיס פתוח
  const decided = demo ? {} : localDecided();
  const cloudReceiptIds = new Set((board.receipts || []).map((r) => r.id));
  const inFlight = Object.entries(decided)
    .filter(([id]) => !cloudReceiptIds.has(id))
    .map(([id, d]) => ({ id, title: titleOf(board, id) || id, verdict: d.verdict, note: d.note, at: d.at, status: "נשלח מהמכשיר, ממתין ללוח" }));

  container.appendChild(renderReceipts(board.receipts || [], inFlight));

  const awaiting = (board.awaiting || []).filter((i) => !decided[i.id]);
  container.appendChild(renderAwaitingSection(awaiting, { token, demo, decided: {} }));

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
  container.appendChild(mk("p", "muted pad", "טוען את הדלפק…"));
  let raw;
  try { raw = await getDrivePathText(token, CONFIG.engineBoardPath); }
  catch (e) {
    container.innerHTML = "";
    container.appendChild(mk("p", "err-msg pad", "שגיאת טעינת הדלפק: " + ((e && e.message) || "שגיאה לא ידועה")));
    return;
  }
  if (raw == null) {
    container.innerHTML = "";
    container.appendChild(mk("div", "card empty", "המכונה עוד לא פרסמה לוח לענן - יופיע כאן אוטומטית."));
    return;
  }
  let board;
  try { board = JSON.parse(raw); }
  catch (e) {
    container.innerHTML = "";
    container.appendChild(mk("p", "err-msg pad", "הלוח מהענן אינו תקין (JSON שבור): " + (e.message || "")));
    return;
  }
  renderPage(container, board, token, { demo: false });
}

// ---------- demo (no auth) ----------
const DEMO_ANSWER = {
  updatedAt: new Date().toISOString(),
  awaiting: [
    { id: "demo-a1", title: "כרטיס לדוגמה: שאלה אחת, כן/לא, הערה במיקרופון.",
      detail: "ככה נראה כרטיס שממתין להכרעה. אחרי התחברות תראה את הכרטיסים האמיתיים.",
      recommendation: "כן", tier: 3 },
  ],
  receipts: [
    { id: "demo-r1", title: "כרטיס שהוכרע אתמול", verdict: "yes",
      note: "ההערה שהכתבת מוצגת כאן, כדי שתראה שהכיוון לא הלך לאיבוד.",
      at: new Date(Date.now() - 86400000).toISOString(), status: "בוצע" },
  ],
};
export function loadAnswerDemo(container) { renderPage(container, DEMO_ANSWER, null, { demo: true }); }
