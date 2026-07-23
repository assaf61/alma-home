// Tiny shared UI helpers (toast + read-aloud + voice dictation).
// speak/micButton are centralized here so every surface (threads, questions,
// actions) gets identical Hebrew TTS + speech-to-text without duplicating code.
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

// ---------- voice dictation into a field (Hebrew speech-to-text) ----------
// mic-v2 (23/07, תיקון answering-page-mic-defect): שלושה כשלים בגרסה הישנה איבדו
// לאסף הודעות שלמות - (א) אנדרואיד סוגר האזנה אחרי שתיקה קצרה גם עם continuous,
// והוא נאלץ ללחוץ שוב ושוב; (ב) בלי interimResults התמלול נמסר רק בסוף, ושגיאת
// no-speech/network מחקה הכל; (ג) עצירה לא-רצונית לא הובחנה מעצירת-משתמש.
// התיקון: הקלטה נמשכת עד שהמשתמש עוצר (התנעה-מחדש אוטומטית ב-onend), תמלול-ביניים
// נכתב לשדה בזמן-אמת (וכך נשמר כטיוטה דרך אירוע input), ושגיאות עצירות רק אחרי
// 4 כשלים רצופים בלי תוצאה או שגיאת-הרשאה קשה.
export function startDictation(target, onState) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast("הכתבה לא נתמכת בדפדפן הזה"); return null; }
  const session = {
    wantOn: true,
    recog: null,
    errors: 0,
    stop() { this.wantOn = false; if (this.recog) { try { this.recog.stop(); } catch (_) {} } },
  };
  const write = (txt) => { target.value = txt; target.dispatchEvent(new Event("input")); };
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
      const fatal = code === "not-allowed" || code === "service-not-allowed" || code === "audio-capture";
      session.errors++;
      if (fatal || session.errors >= 4) {
        session.wantOn = false;
        toast("שגיאת הכתבה" + (code ? " (" + code + ")" : "") + " · מה שנקלט נשמר בשדה");
      }
    };
    r.onend = () => {
      session.recog = null;
      if (session.wantOn) {
        // סגירה שקטה של הדפדפן (שתיקה) - לא עצירת משתמש: ממשיכים להאזין.
        try { run(); return; } catch (_) { session.wantOn = false; }
      }
      if (onState) onState(false);
    };
    r.start();
  };
  try { run(); } catch (_) { toast("הכתבה נכשלה בהתנעה"); return null; }
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
