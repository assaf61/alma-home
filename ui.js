// Tiny shared UI helpers (toast + read-aloud + voice dictation).
// speak/micButton are centralized here so every surface (threads, questions,
// actions) gets identical Hebrew TTS + speech-to-text without duplicating code.
//
// 28/07/2026 - החזרה מלאה למנוע ההכתבה של 23/06/2026 (commit b02f8b1), בהוראת אסף.
// המנוע ההוא עמד באוויר חודש שלם, מ-23/06 עד 23/07, בלי תלונה אחת. ב-23/07 החלפתי
// אותו (mic-v2) בגלל הודעה ארוכה אחת שנקטעה, והוספתי שתי תוספות: התנעה-מחדש
// אוטומטית אחרי שתיקה, וכתיבה רועדת של מילים חצי-מזוהות בזמן אמת. ההתנעה-מחדש היא
// שגרמה למשפט הראשון להיקלט שוב ושוב עד עצירה. v3-v6 (וגם תיקון של סשן מקביל
// ב-26/07) היו טלאים על הטלאי, וכולם נכשלו בשטח.
// הבלוק כאן מוחזר מההיסטוריה כלשונו, בלי שום תוספת: לחיצה אחת שווה קליטה אחת בלי
// לולאה, הטקסט מוצב מחדש ולא נצבר, וכל משפט שנסגר נכתב לשדה תוך כדי הדיבור ונשאר
// יציב וניתן לעריכה.
export const APP_VERSION = "counter v2 · mic-23/06";

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

// 5ni1: a 🎤 button bound to any <textarea>/<input>. Appends recognized speech
// to the field's current value. Returns the button element to place anywhere.
export function micButton(target, opts = {}) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "iconbtn mic" + (opts.compact ? " compact" : "");
  btn.textContent = "🎤";
  btn.title = "הכתב"; btn.setAttribute("aria-label", "הכתבה קולית");
  let recog = null;
  btn.addEventListener("click", () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast("הכתבה לא נתמכת בדפדפן הזה"); return; }
    if (recog) { recog.stop(); return; }
    recog = new SR(); recog.lang = "he-IL"; recog.interimResults = false; recog.continuous = true;
    const base = target.value ? target.value + " " : "";
    recog.onresult = (e) => {
      let acc = "";
      for (let i = e.resultIndex; i < e.results.length; i++) acc += e.results[i][0].transcript;
      target.value = base + acc;
      target.dispatchEvent(new Event("input"));
    };
    recog.onerror = () => toast("שגיאת הכתבה");
    recog.onend = () => { recog = null; btn.classList.remove("on"); btn.textContent = "🎤"; };
    recog.start(); btn.classList.add("on"); btn.textContent = "⏹";
  });
  return btn;
}

// אותו מנוע בדיוק, בחתימה שדרושה למשטחים שמחזיקים כפתור הכתבה משלהם
// (questions.js, threads.js): מחזיר ידית עם stop() ומדווח מצב דרך onState.
// ב-23/06 הקוד הזה ישב בשלושה עותקים זהים; כאן הוא אחד, וההתנהגות זהה לחלוטין.
export function startDictation(target, onState) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast("הכתבה לא נתמכת בדפדפן הזה"); return null; }
  const recog = new SR();
  recog.lang = "he-IL"; recog.interimResults = false; recog.continuous = true;
  const base = target.value ? target.value + " " : "";
  recog.onresult = (e) => {
    let acc = "";
    for (let i = e.resultIndex; i < e.results.length; i++) acc += e.results[i][0].transcript;
    target.value = base + acc;
    target.dispatchEvent(new Event("input"));
  };
  recog.onerror = () => toast("שגיאת הכתבה");
  recog.onend = () => { if (onState) onState(false); };
  recog.start();
  if (onState) onState(true);
  return { stop() { try { recog.stop(); } catch (_) {} } };
}

// Wrap a field with a mic button in a flex row. The field grows, the mic sits beside it.
export function withMic(inputEl, opts = {}) {
  const wrap = document.createElement("div");
  wrap.className = "mic-wrap";
  wrap.appendChild(inputEl);
  wrap.appendChild(micButton(inputEl, opts));
  return wrap;
}
