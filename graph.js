// Microsoft Graph access to the signed-in user's OneDrive for Business.
// Adapted from threads-intake/graph.js. Two scopes of access:
//   - inbox-relative (listInbox / getFileText / putFileReplace) for the dispatcher
//   - arbitrary drive path (getDrivePathText) for the live brief JSON
import { CONFIG } from "./config.js";

const GRAPH = "https://graph.microsoft.com/v1.0";

class RetryableError extends Error {
  constructor(msg, retryAfter) { super(msg); this.retryable = true; this.retryAfter = retryAfter; }
}
export { RetryableError };

function encPath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

// URL for an item inside the inbox folder (relPath is relative to the inbox).
function inboxUrl(relPath, suffix) {
  return `${GRAPH}/me/drive/root:/${encPath(`${CONFIG.inboxPath}/${relPath}`)}:${suffix}`;
}

async function checkResponse(res) {
  if (res.ok) return res;
  if (res.status === 429 || res.status >= 500) {
    const ra = parseInt(res.headers.get("Retry-After") || "5", 10);
    throw new RetryableError(`Graph ${res.status}`, ra);
  }
  const text = await res.text().catch(() => "");
  throw new Error(`Graph ${res.status}: ${text.slice(0, 300)}`);
}

// List recent inbox items (markdown thread files live here).
export async function listInbox(token, top = 50) {
  const url = `${GRAPH}/me/drive/root:/${encPath(CONFIG.inboxPath)}:/children?$top=${top}&$orderby=lastModifiedDateTime desc`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  await checkResponse(res);
  return (await res.json()).value;
}

// 16/08/2026 - יישור סופי-שורה בגבול הקריאה, אחרי שהדלפק התעוור בשקט.
// כל הפרסרים של האפליקציה (parseBody ב-actions, parseOpen ב-questions) מפצלים על
// "\n" ומסיימים ביטוי ב-$ בלי דגל m. ב-JS הביטוי . אינו בולע \r, ולכן שורה שמסתיימת
// ב-CRLF פשוט לא נתפסת: לא כותרת, לא פריט, אפס תוצאות. אין הודעת שגיאה - הקובץ
// נקרא, נפרס, ומחזיר רשימה ריקה. ב-16/08 כותב חיצוני (PowerShell/סקריפט Windows,
// שכותב CRLF כברירת-מחדל) המיר את actions.md ו-open-questions.md במלואם, ושני
// שלישים מהדלפק נכבו: 17 פעולות ממתינות ו-22 שאלות פתוחות נעלמו מהמסך.
// התיקון יושב כאן ולא בכל פרסר בנפרד, כי הגבול הוא המקום היחיד שכל קורא עובר בו.
// הכותבים של האפליקציה (serialize, removeQuestion) פולטים LF ממילא, ולכן קריאה
// מנורמלת + כתיבה מנורמלת מחזירות את הקובץ ל-LF מעצמן.
function normEol(t) { return typeof t === "string" ? t.replace(/\r\n/g, "\n") : t; }

// Read a thread file's text (relPath relative to the inbox).
export async function getFileText(token, relPath) {
  const res = await fetch(inboxUrl(relPath, "/content"), { headers: { Authorization: `Bearer ${token}` } });
  await checkResponse(res);
  return normEol(await res.text());
}

// Overwrite a thread file in place (used by the lock button).
export async function putFileReplace(token, relPath, content) {
  const blob = new Blob([content], { type: "text/markdown" });
  const res = await fetch(inboxUrl(relPath, "/content"), {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/markdown" },
    body: blob,
  });
  await checkResponse(res);
  return res.json();
}

// Read any file by its drive-root-relative path (used for the live brief JSON).
// Returns null on 404 so the caller can fall back gracefully (e.g. no brief yet).
export async function getDrivePathText(token, fullPath) {
  const url = `${GRAPH}/me/drive/root:/${encPath(fullPath)}:/content`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return null;
  await checkResponse(res);
  return normEol(await res.text());
}

// 01/09 (מהדורת-רדיו): שליפה בינארית מאותו נתיב-Graph - ל-mp3 של הבריף.
export async function getDrivePathBlob(token, fullPath) {
  const url = `${GRAPH}/me/drive/root:/${encPath(fullPath)}:/content`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return null;
  await checkResponse(res);
  return res.blob();
}

// zi5i: create a calendar event via Graph (POST /me/events). The write happens
// only on your tap (zero idle egress). Times are local wall-clock with an explicit
// timeZone so Graph stores them correctly regardless of the device locale.
// Needs the Calendars.ReadWrite scope (added at the next login). On 403 the caller
// surfaces a "reconnect to approve calendar access" message.
export async function createCalendarEvent(token, evt) {
  const body = {
    subject: evt.subject || "(ללא כותרת)",
    start: { dateTime: evt.startDateTime, timeZone: evt.tz || "Asia/Jerusalem" },
    end: { dateTime: evt.endDateTime, timeZone: evt.tz || "Asia/Jerusalem" },
  };
  if (evt.location) body.location = { displayName: evt.location };
  if (evt.bodyText) body.body = { contentType: "text", content: evt.bodyText };
  const res = await fetch(`${GRAPH}/me/events`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  await checkResponse(res);
  return res.json();
}

// Overwrite (or create) any file by its drive-root-relative path. Used by the
// questions board to rewrite open-questions.md, append to the archive/log, and
// distribute an answered question into a vault.
export async function putDrivePathText(token, fullPath, content) {
  const blob = new Blob([content], { type: "text/markdown" });
  const url = `${GRAPH}/me/drive/root:/${encPath(fullPath)}:/content`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/markdown" },
    body: blob,
  });
  await checkResponse(res);
  return res.json();
}

// --- capture upload (merged collector): create a NEW file in the inbox ----------
// relPath is inbox-relative (e.g. "2026-...-voice-ab12.md" or "media/...webm").
// conflictBehavior=rename keeps captures create-only (never overwrites), so a
// capture can never fork an existing thread. content: string | Blob.
const SMALL_UPLOAD = 3.5 * 1024 * 1024;
export async function uploadCapture(token, relPath, content, contentType) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: contentType || "text/markdown" });
  if (blob.size > SMALL_UPLOAD) return uploadLarge(token, relPath, blob);
  const res = await fetch(inboxUrl(relPath, "/content?@microsoft.graph.conflictBehavior=rename"), {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": blob.type || "application/octet-stream" },
    body: blob,
  });
  await checkResponse(res);
  return res.json();
}

// Resumable upload session, 5 MB chunks (multiple of 320 KiB per Graph spec).
async function uploadLarge(token, relPath, blob) {
  const sessRes = await fetch(inboxUrl(relPath, "/createUploadSession"), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "rename" } }),
  });
  await checkResponse(sessRes);
  const { uploadUrl } = await sessRes.json();
  const CHUNK = 5 * 1024 * 1024;
  let pos = 0, lastJson = null;
  while (pos < blob.size) {
    const end = Math.min(pos + CHUNK, blob.size);
    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Range": `bytes ${pos}-${end - 1}/${blob.size}`, "Content-Length": String(end - pos) },
      body: blob.slice(pos, end),
    });
    await checkResponse(res);
    if (res.status === 200 || res.status === 201) lastJson = await res.json();
    pos = end;
  }
  return lastJson;
}
