// Capture tab - the collector, merged INTO בית עלמא (jnpv 24/06: one app, not two).
// Reuses alma-home auth + graph. A capture is always a NEW unique file, never an
// edit of an existing one, so it can never fork (aligned with the single-writer cure).
import { getToken } from "./auth.js";
import { uploadCapture, putDrivePathText } from "./graph.js";
import { CONFIG } from "./config.js";
import { toast } from "./ui.js";

const pad = (n) => String(n).padStart(2, "0");
const mk = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const URL_RE = /^https?:\/\/\S+$/;

// Instant triage from memory (Assaf 24/06: the phone is a pipeline - capture fast,
// then route on the spot from memory, no waiting for the transcript). A lock here
// writes a single-writer op; enrich fills the transcript in async.
const DOMES = [["alma-r", "עלמא · פרטי"], ["alma-adinveod", "עדין ועוד · חתום"], ["alma-public", "ציבורי · עתידי"], ["alma-threads", "השאר ב-inbox"]];
const PRIOS = [["p1", "P1"], ["p2", "P2"], ["p3", "P3"]];
const domeLabel = (v) => (DOMES.find((d) => d[0] === v) || [, v])[1];
const idOf = (fileName) => { const m = fileName.match(/-([0-9a-z]{4})\.md$/); return m ? m[1] : fileName.replace(/\.md$/, ""); };
function nowStamp() { const d = new Date(), p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; }

function shortId() {
  const chars = "0123456789abcdefghijklmnopqrstuvwxyz";
  const buf = new Uint8Array(4); crypto.getRandomValues(buf);
  return Array.from(buf, (b) => chars[b % 36]).join("");
}
function device() { return /Android/i.test(navigator.userAgent) ? "android" : "desktop"; }

function extFromMime(type, fallbackName = "") {
  const map = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/mpeg": "mp3",
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/heic": "heic" };
  const base = (type || "").split(";")[0].trim();
  if (map[base]) return map[base];
  const m = fallbackName.match(/\.([A-Za-z0-9]{1,5})$/);
  return m ? m[1].toLowerCase() : "bin";
}

// Mirrors threads-intake/note.js exactly: same filename grammar + frontmatter, so
// the worker (enrich/distribute) treats merged-app captures identically.
function buildNote({ kind, text = "", mediaExt = null, sourceUrl = null }) {
  const d = new Date();
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const stem = `${date}-${pad(d.getHours())}${pad(d.getMinutes())}-${kind}-${shortId()}`;
  const mediaName = mediaExt ? `${stem}.${mediaExt}` : null;
  const fm = ["---", "type: capture", `capture_kind: ${kind}`, "target_vault: alma-threads",
    "status: raw", `created: ${date}`, "owner: assaf", "tags: []", "enriched: false", `device: ${device()}`];
  if (sourceUrl) fm.push(`source_url: "${String(sourceUrl).replace(/["\n\r]/g, "")}"`);
  if (mediaName) fm.push(`media: media/${mediaName}`);
  fm.push("---", "");
  let body = "";
  if (mediaName) body += `![[media/${mediaName}]]\n\n`;
  if (sourceUrl) body += `${sourceUrl}\n\n`;
  if (text) body += `${text}\n`;
  if (!body) body = "\n";
  return { fileName: `${stem}.md`, mediaName, content: fm.join("\n") + body };
}

// ---------- module state ----------
let demoMode = false;
let recorder = null, recChunks = [], recTimerId = null, recStart = 0;

// ---------- overlay helpers (built on demand, removed on close) ----------
function removeOverlay(id) { const el = document.getElementById(id); if (el) el.remove(); }

function openSheet(state) {
  removeOverlay("cap-sheet-wrap");
  const wrap = mk("div", "cap-overlay"); wrap.id = "cap-sheet-wrap";
  const back = mk("div", "cap-backdrop");
  back.addEventListener("click", closeSheet);
  const sheet = mk("div", "cap-sheet");

  const isLink = state.kind === "link";
  sheet.appendChild(mk("div", "cap-sheet-title",
    { text: "כתוב", voice: "הערה להקלטה", photo: "תמונה", link: "לינק" }[state.kind] || "לכידה"));

  // media preview
  if (state.blob && (state.type || "").startsWith("image/")) {
    const img = mk("img", "cap-prev-img"); img.src = URL.createObjectURL(state.blob); sheet.appendChild(img);
  } else if (state.blob && (state.type || "").startsWith("audio/")) {
    const au = mk("audio", "cap-prev-audio"); au.controls = true; au.src = URL.createObjectURL(state.blob); sheet.appendChild(au);
  }

  const ta = mk("textarea", "cap-ta"); ta.id = "cap-ta";
  ta.placeholder = isLink ? "הדבק קישור כאן…" : "כתוב או הוסף הערה…";
  sheet.appendChild(ta);

  const row = mk("div", "cap-sheet-row");
  const send = mk("button", "btn-primary", "שלח ✓"); send.type = "button";
  send.addEventListener("click", () => sendCapture(state, ta));
  const cancel = mk("button", "btn-ghost", "ביטול"); cancel.type = "button";
  cancel.addEventListener("click", closeSheet);
  row.appendChild(send); row.appendChild(cancel);
  sheet.appendChild(row);

  wrap.appendChild(back); wrap.appendChild(sheet);
  document.body.appendChild(wrap);
  if (!state.blob) setTimeout(() => ta.focus(), 50);
}
function closeSheet() { removeOverlay("cap-sheet-wrap"); }

async function sendCapture(state, ta) {
  let text = (ta.value || "").trim();
  let { kind, blob, type, fileName, sourceUrl } = state;
  if (!text && !blob && !sourceUrl) { toast("אין מה לשלוח"); return; }
  // a pure URL typed into text becomes a link capture
  if (!sourceUrl && !blob && URL_RE.test(text)) { kind = "link"; sourceUrl = text; text = ""; }
  if (kind === "link" && !sourceUrl && URL_RE.test(text)) { sourceUrl = text; text = ""; }
  const mediaExt = blob ? extFromMime(type, fileName) : null;
  const note = buildNote({ kind, text, mediaExt, sourceUrl });

  if (demoMode) { closeSheet(); toast("מצב הדגמה · נקלט ✓"); return; }

  const btn = document.querySelector("#cap-sheet-wrap .btn-primary");
  if (btn) { btn.disabled = true; btn.textContent = "שולח…"; }
  try {
    const token = await getToken();
    if (!token) { toast("התחבר תחילה"); if (btn) { btn.disabled = false; btn.textContent = "שלח ✓"; } return; }
    // media first: a note that references missing media is a broken capture
    if (blob && note.mediaName) await uploadCapture(token, `media/${note.mediaName}`, blob, type);
    await uploadCapture(token, note.fileName, note.content, "text/markdown");
    showTriage(note.fileName, token);   // hand straight to triage-from-memory
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = "שלח ✓"; }
    toast("שגיאת שליחה · " + (e.message || ""));
  }
}

// After send: hand straight to triage. Routing decision is captured at peak context
// (right after speaking, from memory), written as a single-writer lock op; the
// transcript catches up async. "אחר כך / במחשב" defers the drill-down to the cockpit.
function showTriage(fileName, token) {
  const wrap = document.getElementById("cap-sheet-wrap");
  const sheet = wrap && wrap.querySelector(".cap-sheet");
  if (!sheet) { toast("נקלט ✓"); return; }
  sheet.innerHTML = "";
  sheet.appendChild(mk("div", "cap-sheet-title", "נקלט ✓ · מיין מהזיכרון (או אחר כך במחשב)"));

  let dome = "alma-r", prio = "";
  sheet.appendChild(mk("div", "cap-flbl", "דום"));
  const domeWrap = mk("div", "cap-pills");
  DOMES.forEach(([v, l]) => {
    const b = mk("button", "cap-pill" + (v === dome ? " sel" : ""), l); b.type = "button";
    b.addEventListener("click", () => { domeWrap.querySelectorAll(".cap-pill").forEach((p) => p.classList.remove("sel")); b.classList.add("sel"); dome = v; });
    domeWrap.appendChild(b);
  });
  sheet.appendChild(domeWrap);

  sheet.appendChild(mk("div", "cap-flbl", "עדיפות"));
  const prioWrap = mk("div", "cap-pills");
  PRIOS.forEach(([v, l]) => {
    const b = mk("button", "cap-pill", l); b.type = "button";
    b.addEventListener("click", () => { const was = b.classList.contains("sel"); prioWrap.querySelectorAll(".cap-pill").forEach((p) => p.classList.remove("sel")); prio = was ? "" : v; if (!was) b.classList.add("sel"); });
    prioWrap.appendChild(b);
  });
  sheet.appendChild(prioWrap);

  const ta = mk("textarea", "cap-ta"); ta.placeholder = "הערה מהזיכרון (לא חובה)…"; ta.style.minHeight = "70px";
  sheet.appendChild(ta);

  const row = mk("div", "cap-sheet-row");
  const lock = mk("button", "btn-primary", "נעל ותייק"); lock.type = "button";
  lock.addEventListener("click", async () => {
    if (demoMode) { closeSheet(); toast("מצב הדגמה · נעול → " + domeLabel(dome)); return; }
    lock.disabled = true; lock.textContent = "נועל…";
    try {
      const id = idOf(fileName);
      const op = { op: "lock", thread: fileName, id, vault: dome, priority: prio, remark: ta.value || "", at: nowStamp() };
      const rand = Math.random().toString(36).slice(2, 8);
      const opPath = `${CONFIG.inboxPath}/_ops/op-${nowStamp().replace(/[^0-9]/g, "")}-${id}-${rand}.json`;
      await putDrivePathText(token, opPath, JSON.stringify(op, null, 2));
      closeSheet(); toast("נעול → " + domeLabel(dome) + " · יתויק בסבב הבא");
    } catch (e) { lock.disabled = false; lock.textContent = "נעל ותייק"; toast("נעילה נכשלה · " + (e.message || "")); }
  });
  const later = mk("button", "btn-ghost", "אחר כך / במחשב"); later.type = "button";
  later.addEventListener("click", () => { closeSheet(); toast("נשלח ✓ · תמיין במחשב"); });
  row.appendChild(lock); row.appendChild(later);
  sheet.appendChild(row);
}

// ---------- photo: camera / gallery chooser ----------
function pickPhoto() {
  removeOverlay("cap-photo-wrap");
  const wrap = mk("div", "cap-overlay"); wrap.id = "cap-photo-wrap";
  const back = mk("div", "cap-backdrop"); back.addEventListener("click", () => removeOverlay("cap-photo-wrap"));
  const menu = mk("div", "cap-menu");
  const cam = mk("input"); cam.type = "file"; cam.accept = "image/*"; cam.capture = "environment"; cam.hidden = true;
  const gal = mk("input"); gal.type = "file"; gal.accept = "image/*"; gal.hidden = true;
  const onPick = (e) => { const f = e.target.files && e.target.files[0]; removeOverlay("cap-photo-wrap"); if (f) openSheet({ kind: "photo", blob: f, type: f.type, fileName: f.name }); };
  cam.onchange = onPick; gal.onchange = onPick;
  const bCam = mk("button", "btn-primary", "📷 מצלמה"); bCam.type = "button"; bCam.addEventListener("click", () => cam.click());
  const bGal = mk("button", "btn-ghost", "🖼 גלריה"); bGal.type = "button"; bGal.addEventListener("click", () => gal.click());
  menu.appendChild(bCam); menu.appendChild(bGal); menu.appendChild(cam); menu.appendChild(gal);
  wrap.appendChild(back); wrap.appendChild(menu);
  document.body.appendChild(wrap);
}

// ---------- voice recording ----------
async function startRec() {
  if (demoMode) { toast("מצב הדגמה · הקלטה לא זמינה"); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "";
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined);
    recChunks = [];
    recorder.ondataavailable = (e) => e.data.size && recChunks.push(e.data);
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      clearInterval(recTimerId);
      removeOverlay("cap-rec-wrap");
      const blob = new Blob(recChunks, { type: recorder.mimeType || "audio/webm" });
      if (blob.size > 0) openSheet({ kind: "voice", blob, type: blob.type, fileName: "rec.webm" });
    };
    recorder.start();
    recStart = Date.now();

    const wrap = mk("div", "cap-overlay"); wrap.id = "cap-rec-wrap";
    const box = mk("div", "cap-rec");
    box.appendChild(mk("div", "cap-rec-dot"));
    const timer = mk("div", "cap-rec-timer", "0:00");
    box.appendChild(timer);
    const stop = mk("button", "btn-primary", "⏹ עצור"); stop.type = "button";
    stop.addEventListener("click", () => recorder && recorder.state !== "inactive" && recorder.stop());
    const cancel = mk("button", "btn-ghost", "בטל"); cancel.type = "button";
    cancel.addEventListener("click", () => {
      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = () => { recorder.stream && recorder.stream.getTracks && recorder.stream.getTracks().forEach((t) => t.stop()); clearInterval(recTimerId); removeOverlay("cap-rec-wrap"); };
        recorder.stop();
      } else { removeOverlay("cap-rec-wrap"); }
    });
    box.appendChild(stop); box.appendChild(cancel);
    wrap.appendChild(box);
    document.body.appendChild(wrap);

    recTimerId = setInterval(() => {
      const s = Math.floor((Date.now() - recStart) / 1000);
      timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    }, 500);
  } catch (e) {
    toast("אין גישה למיקרופון");
  }
}

// ---------- public entry ----------
export function loadCapture(token, container, opts = {}) {
  demoMode = !!opts.demo;
  container.innerHTML = "";

  const head = mk("div", "thr-head");
  head.appendChild(mk("span", "over", "לכידה"));
  head.appendChild(mk("span", "thr-count", "מה עולה לך?"));
  container.appendChild(head);

  const grid = mk("div", "cap-grid");
  const actions = [
    ["✍️", "כתוב", () => openSheet({ kind: "text" })],
    ["🎤", "הקלט", () => startRec()],
    ["📷", "צלם", () => pickPhoto()],
    ["🔗", "לינק", () => openSheet({ kind: "link" })],
  ];
  actions.forEach(([ico, label, fn]) => {
    const b = mk("button", "cap-btn"); b.type = "button";
    b.appendChild(mk("span", "cap-ico", ico));
    b.appendChild(mk("span", "cap-lbl", label));
    b.addEventListener("click", fn);
    grid.appendChild(b);
  });
  container.appendChild(grid);

  container.appendChild(mk("p", "hint", demoMode
    ? "מצב הדגמה - הלכידה לא נשלחת ל-OneDrive."
    : "כל לכידה נשמרת ל-OneDrive ועוברת תמלול ומיון אוטומטי. חוט חדש = קובץ חדש, לעולם לא מתנגש."));
}

export function loadCaptureDemo(container) { loadCapture(null, container, { demo: true }); }
