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

// Read a thread file's text (relPath relative to the inbox).
export async function getFileText(token, relPath) {
  const res = await fetch(inboxUrl(relPath, "/content"), { headers: { Authorization: `Bearer ${token}` } });
  await checkResponse(res);
  return res.text();
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
  return res.text();
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
