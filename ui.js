// Tiny shared UI helpers (toast + read-aloud + voice dictation).
// speak/micButton are centralized here so every surface (threads, questions,
// actions) gets identical Hebrew TTS + speech-to-text without duplicating code.
import { getToken } from "./auth.js";
import { uploadCapture } from "./graph.js";
import { kvGet, kvSet } from "./queue.js";

// גרסה גלויה (25/07): "נדחף" ו"מוגש" ו"מגיע לטלפון" הן שלוש טענות נפרדות. הבאדג'
// בתחתית עמוד-המענה הופך את השלישית לניתנת-לבדיקה בהצצה אחת, בלי לנחש.
export const APP_VERSION = "v32 · mic-v4";
let toastEl = null;
let toastTimer = null;

export function toast(msg, ms = 2600) {
  if (!toastEl) { toastEl = document.getElementById("toast"); }
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), ms);
}

// ---------- tap-vs-scroll guard (px64) ----------
// A row header used to open on any click, so on the phone a scroll gesture that
// started on a header registered as a tap and popped open the wrong thread. onTap
// fires only when the pointer barely moved between down and up (a real tap); a drag
// (scroll) is ignored. Keyboard activation (Enter/Space) is preserved for a11y.
export function onTap(el, handler, moveTol = 10) {
  let sx = 0, sy = 0, moved = false, down = false;
  el.addEventListener("pointerdown", (e) => { down = true; moved = false; sx = e.clientX; sy = e.clientY; });
  el.addEventListener("pointermove", (e) => { if (down && (Math.abs(e.clientX - sx) > moveTol || Math.abs(e.clientY - sy) > moveTol)) moved = true; });
  el.addEventListener("pointerup", (e) => { const tap = down && !moved; down = false; if (tap) handler(e); });
  el.addEventListener("pointercancel", () => { down = false; moved = false; });
  el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handler(e); } });
}

// ---------- read-aloud (Hebrew TTS) - matches Assaf's "הקרא לי" preference ----------
let speaking = false;
export function speak(txt) {
  if (!("speechSynthesis" in window)) { toast("הדפדפן לא תומך בהקראה"); return; }
  if (speaking) { speechSynthesis.cancel(); speaking = false; return; }
  const u = new SpeechSynthesisUtterance(txt); u.lang = "he-IL"; u.rate = 1;
  const v = speechSynthesis.getVoices().find((x) => x.lang && x.lang.startsWith("he"));
  if (v) u.voice = v;
  u.onend = () => { speaking = false; };
  speaking = true; speechSynthesis.speak(u);
}

// ---------- persistent dictation draft (mic-v3, 25/07: "הודעה לא יכולה לעוף") ----------
// כל מילה שמזוהה נשמרת מיד: בזיכרון (לכל שדה בנפרד, לשחזור מיידי כשהמיקרופון נקטע)
// וגם ל-localStorage כחוצץ "אחרון" (רשת-ביטחון לשחזור ידני גם אחרי קריסת-טאב).
// שמירה מבודדת פר-שדה (WeakMap) - אין דליפה של הודעה מכרטיס אחד לאחר.
const liveDraft = new WeakMap();
function saveLastDraft(txt) { try { localStorage.setItem("ah-draft:last", JSON.stringify({ t: txt, at: Date.now() })); } catch (_) {} }
// שליפת ההודעה האחרונה שנקלטה בכל שדה שהוא - רשת-הביטחון האחרונה לשחזור ידני.
export function recoverLastDraft() { try { const o = JSON.parse(localStorage.getItem("ah-draft:last") || "null"); return (o && o.t) || ""; } catch (_) { return ""; } }

// ---------- audio safety net (mic-v4, 25/07) ----------
// v3 עדיין נכשל אצל אסף: ההכתבה של אנדרואיד היא הצוואר החלש, ואי אפשר לתקן אותה
// מבחוץ. לכן הקול עצמו מוקלט במקביל (MediaRecorder - אותו מנגנון מוכח שכבר עובד
// בלוכד). אם ההכתבה לא החזירה מילה אחת, ההקלטה נשלחת ל-inbox והמכונה מתמללת אותה.
// כלומר: גם כשההכתבה נופלת, ההודעה עצמה כבר לא יכולה ללכת לאיבוד.
function startAudioNet() {
  const net = { rec: null, chunks: [], stream: null, dead: false, ready: null };
  net.ready = (navigator.mediaDevices && navigator.mediaDevices.getUserMedia
    ? navigator.mediaDevices.getUserMedia({ audio: true })
    : Promise.reject(new Error("no getUserMedia")))
    .then((stream) => {
      if (net.dead) { stream.getTracks().forEach((t) => t.stop()); return; }
      net.stream = stream;
      const mime = (window.MediaRecorder && MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) ? "audio/webm;codecs=opus" : "";
      net.rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined);
      net.rec.ondataavailable = (e) => { if (e.data && e.data.size) net.chunks.push(e.data); };
      net.rec.start(1000);   // נתח כל שנייה: גם קריסה פתאומית משאירה את מה שנאמר עד אליה
    })
    .catch(() => { net.dead = true; });   // אין מיקרופון/הרשאה - ההכתבה לבדה, בלי להפיל כלום
  net.stop = async () => {
    try { await net.ready; } catch (_) {}
    const rec = net.rec;
    const blob = await new Promise((res) => {
      if (!rec || rec.state === "inactive") return res(net.chunks.length ? new Blob(net.chunks, { type: net.chunks[0].type || "audio/webm" }) : null);
      rec.onstop = () => res(net.chunks.length ? new Blob(net.chunks, { type: rec.mimeType || "audio/webm" }) : null);
      try { rec.stop(); } catch (_) { res(null); }
    });
    if (net.stream) net.stream.getTracks().forEach((t) => t.stop());
    net.dead = true;
    return blob;
  };
  return net;
}

const pad2 = (n) => String(n).padStart(2, "0");
function shortId() {
  const chars = "0123456789abcdefghijklmnopqrstuvwxyz";
  const buf = new Uint8Array(4); crypto.getRandomValues(buf);
  return Array.from(buf, (b) => chars[b % 36]).join("");
}

// כותרת הכרטיס שהשדה יושב בתוכו - כדי שההודעה הקולית תגיע עם ההקשר שלה
// ולא כהקלטה יתומה. נגזר מה-DOM, בלי לשנות את כל משטחי-הקריאה.
function contextOf(target) {
  try {
    const card = target.closest && target.closest(".thr, .card, .qrow");
    const t = card && card.querySelector(".sum, .q-text, .rcp-t");
    return (t && t.textContent.trim().slice(0, 120)) || "";
  } catch (_) { return ""; }
}

// שיגור ההקלטה ל-inbox בדקדוק של הלוכד, כך שה-enrich מתמלל אותה כרגיל.
async function sendVoice(token, blob, ctx, stem) {
  const name = `${stem}.webm`;
  const date = stem.slice(0, 10);
  const fm = ["---", "type: capture", "capture_kind: voice", "target_vault: alma-threads",
    "status: raw", `created: ${date}`, "owner: assaf", "tags: []", "enriched: false",
    `device: ${/Android/i.test(navigator.userAgent) ? "android" : "desktop"}`,
    `media: media/${name}`, "---", ""];
  const body = `![[media/${name}]]\n\nהודעה קולית שנחלצה: ההכתבה לא קלטה טקסט, הקול נשמר במקומה.`
    + (ctx ? `\nההקשר: ${ctx}` : "") + "\n";
  await uploadCapture(token, `media/${name}`, blob, blob.type || "audio/webm");
  await uploadCapture(token, `${stem}.md`, fm.join("\n") + body, "text/markdown");
}

function voiceStem() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}-voice-${shortId()}`;
}

// הקלטה שלא הצליחה להישלח (אין חיבור / רשת נפלה) נשמרת באמת ב-IndexedDB ומשוגרת
// בהזדמנות הבאה. בלי זה ההבטחה "יישלח בהתחברות הבאה" הייתה אמירה ריקה.
const PEND_KEY = "voice-pending";
async function stashVoice(rec) {
  try { const list = (await kvGet(PEND_KEY)) || []; list.push(rec); await kvSet(PEND_KEY, list.slice(-20)); return true; }
  catch (_) { return false; }
}
export async function flushPendingVoices() {
  let list = null;
  try { list = await kvGet(PEND_KEY); } catch (_) { return; }
  if (!list || !list.length) return;
  const token = await getToken().catch(() => null);
  if (!token) return;
  const left = [];
  for (const r of list) {
    try { await sendVoice(token, r.blob, r.ctx, r.stem); } catch (_) { left.push(r); }
  }
  try { await kvSet(PEND_KEY, left); } catch (_) {}
  const sent = list.length - left.length;
  if (sent > 0) toast(sent === 1 ? "הודעה קולית ממתינה נשלחה ✓" : `${sent} הודעות קוליות ממתינות נשלחו ✓`);
}

async function rescueVoice(blob, ctx) {
  const stem = voiceStem();
  const token = await getToken().catch(() => null);
  if (!token) {
    const kept = await stashVoice({ blob, ctx, stem, at: Date.now() });
    toast(kept ? "ההכתבה לא קלטה · הקול נשמר במכשיר ויישלח בהתחברות הבאה"
               : "ההכתבה לא קלטה ואי אפשר לשמור את הקול · אל תסגור, התחבר ונסה שוב");
    return false;
  }
  try { await sendVoice(token, blob, ctx, stem); return true; }
  catch (e) {
    const kept = await stashVoice({ blob, ctx, stem, at: Date.now() });
    if (kept) { toast("השליחה נכשלה · הקול נשמר במכשיר ויישלח בניסיון הבא"); return false; }
    throw e;
  }
}

// ---------- voice dictation into a field (Hebrew speech-to-text) ----------
// mic-v3 (25/07, answering-page-mic-defect שחזר על אנדרואיד אחרי v2): v2 התניע
// מחדש מיד ב-onend, אבל באנדרואיד המיקרופון לא הספיק להשתחרר ולהיתפס - נוצרה
// לולאה שבה הכפתור "דלוק" אך לא נקלט דבר, והודעה שלמה אבדה. התיקון: (א) השהיה
// זעירה בהתנעה-מחדש כדי שהמיקרופון ייתפס נקי, עם ניסיון-חוזר בגיבוי; (ב) שגיאות
// no-speech/aborted (שגרתיות בין התנעות) לא נספרות ככשל ולא מפילות; (ג) כל מה
// שנקלט נשמר חי (WeakMap + localStorage) וניתן לשחזור אם ההקלטה נקטעה.
export function startDictation(target, onState) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const baseline = target.value || "";
  const net = startAudioNet();          // הקול מוקלט תמיד, במקביל להכתבה
  let finished = false;
  flushPendingVoices();                 // הזדמנות לשגר קול שנתקע מפעם קודמת (שקט, לא חוסם)

  // סיום יחיד ומובטח: עוצר את ההקלטה, ואם ההכתבה לא הוסיפה ולו מילה - מחלץ את הקול.
  const finish = async () => {
    if (finished) return;
    finished = true;
    let blob = null;
    try { blob = await net.stop(); } catch (_) {}
    const gained = (target.value || "").slice(baseline.length).trim();
    if (!gained && blob && blob.size > 1500) {
      try {
        if (await rescueVoice(blob, contextOf(target))) toast("ההכתבה לא קלטה · הקול נשלח, המכונה תתמלל ✓");
      } catch (e) { toast("ההכתבה והשליחה נכשלו · " + ((e && e.message) || "")); }
    }
    if (onState) onState(false);
  };

  const session = {
    wantOn: true,
    recog: null,
    errors: 0,
    stop() { this.wantOn = false; if (this.recog) { try { this.recog.stop(); } catch (_) { finish(); } } else finish(); },
  };

  // דפדפן בלי הכתבה (או שהיא חסומה): לא מוותרים - הופכים את הכפתור להודעה קולית.
  if (!SR) {
    toast("הכתבה לא נתמכת כאן · מקליט הודעה קולית");
    if (onState) onState(true);
    return session;
  }
  const write = (txt) => { target.value = txt; liveDraft.set(target, txt); saveLastDraft(txt); target.dispatchEvent(new Event("input")); };
  const run = () => {
    const r = new SR(); session.recog = r;
    r.lang = "he-IL"; r.continuous = true; r.interimResults = true;
    // בסיס מחושב בכל התנעה(-מחדש): כל מה שכבר בשדה נשמר, כולל ביניים מסשן קודם.
    let committed = target.value ? (target.value.endsWith(" ") ? target.value : target.value + " ") : "";
    r.onresult = (e) => {
      session.errors = 0;
      let fin = "", interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) fin += t; else interim += t;
      }
      if (fin) committed += fin;
      write(committed + interim);
    };
    r.onerror = (e) => {
      const code = (e && e.error) || "";
      // no-speech/aborted הם שגרתיים באנדרואיד בין התנעות - לא נספרים ככשל ולא מפילים.
      if (code === "no-speech" || code === "aborted") return;
      const fatal = code === "not-allowed" || code === "service-not-allowed" || code === "audio-capture";
      session.errors++;
      if (fatal || session.errors >= 5) {
        session.wantOn = false;
        toast("שגיאת הכתבה" + (code ? " (" + code + ")" : "") + " · מה שנקלט נשמר בשדה");
      }
    };
    r.onend = () => {
      session.recog = null;
      if (!session.wantOn) { finish(); return; }
      // סגירה שקטה של הדפדפן (שתיקה) - לא עצירת משתמש: ממשיכים להאזין.
      // באנדרואיד השהיה זעירה נותנת למיקרופון להשתחרר ולהיתפס מחדש נקי, ומונעת
      // לולאת-התנעה-חנוקה שבה המיקרופון "דלוק" אך לא קולט דבר (וכך אבדו הודעות).
      const restart = (delay, lastTry) => setTimeout(() => {
        if (!session.wantOn) { finish(); return; }
        try { run(); }
        catch (_) {
          if (lastTry) { session.wantOn = false; finish(); }
          else restart(400, true);
        }
      }, delay);
      restart(150, false);
    };
    r.start();
  };
  // כשל בהתנעת ההכתבה אינו סוף הדרך: ההקלטה כבר רצה, וההודעה תישלח כקול.
  try { run(); } catch (_) { toast("ההכתבה לא נפתחה · מקליט הודעה קולית"); }
  if (onState) onState(true);
  return session;
}

// 5ni1: a 🎤 button bound to any <textarea>/<input>. Appends recognized speech
// to the field's current value. Returns the button element to place anywhere.
export function micButton(target, opts = {}) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "iconbtn mic" + (opts.compact ? " compact" : "");
  btn.textContent = "🎤";
  btn.title = "הכתב"; btn.setAttribute("aria-label", "הכתבה קולית");
  let session = null;
  btn.addEventListener("click", () => {
    if (session) { session.stop(); session = null; return; }
    // אם השדה ריק אבל נקלטה בו הודעה שנקטעה (מיקרופון שמת) - משחזרים אותה לפני שממשיכים.
    // WeakMap פר-שדה: משחזר רק את ההודעה של השדה הזה עצמו, בלי לדלוף מכרטיס אחר.
    if (!target.value) {
      const d = liveDraft.get(target);
      if (d) { target.value = d; liveDraft.set(target, d); target.dispatchEvent(new Event("input")); toast("שוחזרה טיוטה שנקטעה"); }
    }
    session = startDictation(target, (on) => {
      if (on) { btn.classList.add("on"); btn.textContent = "⏹"; }
      else { session = null; btn.classList.remove("on"); btn.textContent = "🎤"; }
    });
  });
  return btn;
}

// Wrap a field with a mic button in a flex row. The field grows, the mic sits beside it.
export function withMic(inputEl, opts = {}) {
  const wrap = document.createElement("div");
  wrap.className = "mic-wrap";
  wrap.appendChild(inputEl);
  wrap.appendChild(micButton(inputEl, opts));
  return wrap;
}
