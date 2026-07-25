// Tiny shared UI helpers (toast + read-aloud + voice dictation).
// speak/micButton are centralized here so every surface (threads, questions,
// actions) gets identical Hebrew TTS + speech-to-text without duplicating code.
import { getToken } from "./auth.js";
import { uploadCapture } from "./graph.js";
import { kvGet, kvSet } from "./queue.js";

// גרסה גלויה (25/07): "נדחף" ו"מוגש" ו"מגיע לטלפון" הן שלוש טענות נפרדות. הבאדג'
// בתחתית עמוד-המענה הופך את השלישית לניתנת-לבדיקה בהצצה אחת, בלי לנחש.
export const APP_VERSION = "v34 · mic-nodup";
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

// ---------- הוסר: הקלטה מקבילה (mic-v4, חי רק 25/07 בין 12:00 ל-14:00) ----------
// v4 הריץ MediaRecorder במקביל להכתבה. שתי צרכניות מיקרופון על אנדרואיד נלחמות,
// וההכתבה הפסיקה לכתוב בכלל: "זה רק מקליט את הכל וזהו, אין לי שום פידבק שמה שאני
// אומר נכון ואין לי דרך לערוך" (אסף, 25/07). קול שנשלח אינו תחליף לטקסט שרואים
// ואפשר לתקן. ההקלטה המקבילה הוסרה; מה שנשאר הוא ניקוז חד-כיווני של הקלטות v4
// שנתקעו במכשיר, בלי ליצור חדשות.

// שיגור הקלטה שנתקעה ל-inbox בדקדוק של הלוכד, כך שה-enrich מתמלל אותה כרגיל.
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

// ניקוז חד-כיווני: הקלטות שנוצרו ב-v4 ולא הספיקו לצאת מהמכשיר עדיין משוגרות,
// כדי שלא יישארו יתומות. אין יותר יצירה של הקלטות חדשות.
const PEND_KEY = "voice-pending";
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

// ---------- voice dictation into a field (Hebrew speech-to-text) ----------
// mic-v5 (25/07): החזרה למנוע הקנוני של 19/07 (guard/cockpit/mic.js), אחרי שלושה
// תיקונים קדימה (v2/v3/v4) שכולם החמירו. הכלל שהופר: מחזקים שיטה קיימת, לא בונים
// חדשה. שלושת העקרונות של המנוע, כל אחד נגד מחלה שאסף חי:
//   1. רואים תוך כדי - interim נכתב חי לשדה, ולכן אפשר לתקן טעות תוך כדי דיבור.
//   2. לא מת בשקט - זיהוי שנגמר בזמן שהכפתור דלוק קם מחדש מיד; עצירה רק בלחיצה
//      או בשגיאה קשה (הרשאה/חומרה). no-speech ו-network לא עוצרים כלום.
//   3. כשל מדבר - עברית ברורה, ומה שנקלט כבר יושב בשדה ובטיוטה, לא נעלם.
// מה שאין כאן בכוונה: הקלטת-קול מקבילה. היא הרגה את ההכתבה (v4).
const HARD_ERR = {
  "not-allowed": "אין הרשאת מיקרופון · אשר בהגדרות הדפדפן",
  "service-not-allowed": "שירות הזיהוי חסום בדפדפן",
  "audio-capture": "לא נמצא מיקרופון",
};
export function startDictation(target, onState) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast("הכתבה לא נתמכת בדפדפן הזה"); return null; }
  flushPendingVoices();   // ניקוז חד-כיווני: הקלטות v4 שנתקעו במכשיר יוצאות, בלי חדשות

  const session = { active: true, recog: null };
  // carried = מה שהיה בשדה לפני הלחיצה + מה שנצבר מהתנעות קודמות.
  // sessionText = כל מה שהזיהוי הנוכחי מחזיק, ונבנה מחדש מאפס בכל אירוע.
  let carried = target.value || "", sessionText = "";
  const compose = () => {
    const txt = [carried, sessionText].filter((x) => x && x.trim()).join(" ").replace(/\s+/g, " ").trim();
    target.value = txt;
    liveDraft.set(target, txt); saveLastDraft(txt);
    try { target.dispatchEvent(new Event("input", { bubbles: true })); } catch (_) {}
  };

  const start = () => {
    const r = new SR(); session.recog = r;
    r.lang = "he-IL"; r.continuous = true; r.interimResults = true;
    // שורש הבאג שקבר את ההודעות של אסף (נצפה 25/07 10:45, שוחזר במעבדה): המנוע
    // הקודם קרא מ-ev.resultIndex והוסיף (+=) לצובר. אנדרואיד מחזיר resultIndex=0
    // בזמן ש-ev.results מצטבר, ולכן כל אירוע הוסיף שוב את כל מה שכבר נאמר -
    // "בבקשה", "בבקשה בבקשה התקדם", "בבקשה בבקשה התקדם בבקשה התקדם עם"...
    // התיקון: לא לצבור לעולם. לבנות את התמליל מחדש מכל ev.results בכל אירוע.
    // הפעולה אידמפוטנטית: אותו קלט תמיד נותן אותו טקסט, לא משנה כמה פעמים יגיע.
    r.onresult = (ev) => {
      let fin = "", interim = "";
      for (let i = 0; i < ev.results.length; i++) {
        const res = ev.results[i];
        const t = (res[0] && res[0].transcript) || "";
        if (res.isFinal) fin += (fin ? " " : "") + t.trim();
        else interim += t;
      }
      sessionText = [fin, interim].filter((x) => x && x.trim()).join(" ");
      compose();
    };
    r.onerror = (ev) => {
      const code = (ev && ev.error) || "";
      if (HARD_ERR[code]) {
        session.active = false;
        toast(HARD_ERR[code]);
      }
      // no-speech / network / aborted: לא עוצרים - onend ידליק מחדש אם עדיין פעיל
    };
    r.onend = () => {
      session.recog = null;
      // ההתנעה הבאה מתחילה עם ev.results ריק, ולכן מה שנצבר בסשן הזה חייב לעבור
      // ל-carried לפני שהוא מתאפס. בלי זה כל שתיקה הייתה מוחקת את מה שנאמר עד כה.
      if (sessionText && sessionText.trim()) {
        carried = [carried, sessionText].filter((x) => x && x.trim()).join(" ").replace(/\s+/g, " ").trim();
      }
      sessionText = "";
      if (session.active) {
        try { start(); return; } catch (_) { session.active = false; }
      }
      compose();
      if (onState) onState(false);
    };
    r.start();
  };

  session.stop = function () {
    this.active = false;
    if (this.recog) { try { this.recog.stop(); } catch (_) { compose(); if (onState) onState(false); } }
    else { compose(); if (onState) onState(false); }
    // "כשל מדבר": אחרי עצירה אסף יודע מיד אם נקלט משהו או שהוא דיבר לחלל.
    setTimeout(() => toast(target.value && target.value.trim() ? "נקלט ✓ · אפשר לערוך" : "לא נקלט דבר · בדוק הרשאת מיקרופון ונסה שוב"), 60);
  };

  try { start(); } catch (e) { toast("הזיהוי לא נפתח · " + ((e && e.message) || "")); return null; }
  if (onState) onState(true);
  toast("מקליט · המילים יופיעו בשדה תוך כדי");
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
