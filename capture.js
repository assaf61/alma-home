// Capture tab - the collector, merged INTO בית עלמא (jnpv 24/06: one app, not two).
// Reuses alma-home auth + graph. A capture is always a NEW unique file, never an
// edit of an existing one, so it can never fork (aligned with the single-writer cure).
import { getToken } from "./auth.js";
import { uploadCapture } from "./graph.js";
import { toast } from "./ui.js";

const pad = (n) => String(n).padStart(2, "0");
const mk = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const URL_RE = /^https?:\/\/\S+$/;

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
    closeSheet();
    toast("נקלט ✓ · יתומלל וימוין אוטומטית");
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = "שלח ✓"; }
    toast("שגיאת שליחה · " + (e.message || ""));
  }
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
