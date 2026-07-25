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

// ---------- persistent dictation draft (mic-v3, 25/07: "הודעה לא יכולה לעוף") ----------
// כל מילה שמזוהה נשמרת מיד: בזיכרון (לכל שדה בנפרד, לשחזור מיידי כשהמיקרופון נקטע)
// וגם ל-localStorage כחוצץ "אחרון" (רשת-ביטחון לשחזור ידני גם אחרי קריסת-טאב).
// שמירה מבודדת פר-שדה (WeakMap) - אין דליפה של הודעה מכרטיס אחד לאחר.
const liveDraft = new WeakMap();
function saveLastDraft(txt) { try { localStorage.setItem("ah-draft:last", JSON.stringify({ t: txt, at: Date.now() })); } catch (_) {} }
// שליפת ההודעה האחרונה שנקלטה בכל שדה שהוא - רשת-הביטחון האחרונה לשחזור ידני.
export function recoverLastDraft() { try { const o = JSON.parse(localStorage.getItem("ah-draft:last") || "null"); return (o && o.t) || ""; } catch (_) { return ""; } }

// ---------- voice dictation into a field (Hebrew speech-to-text) ----------
// mic-v3 (25/07, answering-page-mic-defect שחזר על אנדרואיד אחרי v2): v2 התניע
// מחדש מיד ב-onend, אבל באנדרואיד המיקרופון לא הספיק להשתחרר ולהיתפס - נוצרה
// לולאה שבה הכפתור "דלוק" אך לא נקלט דבר, והודעה שלמה אבדה. התיקון: (א) השהיה
// זעירה בהתנעה-מחדש כדי שהמיקרופון ייתפס נקי, עם ניסיון-חוזר בגיבוי; (ב) שגיאות
// no-speech/aborted (שגרתיות בין התנעות) לא נספרות ככשל ולא מפילות; (ג) כל מה
// שנקלט נשמר חי (WeakMap + localStorage) וניתן לשחזור אם ההקלטה נקטעה.
export function startDictation(target, onState) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast("הכתבה לא נתמכת בדפדפן הזה"); return null; }
  const session = {
    wantOn: true,
    recog: null,
    errors: 0,
    stop() { this.wantOn = false; if (this.recog) { try { this.recog.stop(); } catch (_) {} } },
  };
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
      if (!session.wantOn) { if (onState) onState(false); return; }
      // סגירה שקטה של הדפדפן (שתיקה) - לא עצירת משתמש: ממשיכים להאזין.
      // באנדרואיד השהיה זעירה נותנת למיקרופון להשתחרר ולהיתפס מחדש נקי, ומונעת
      // לולאת-התנעה-חנוקה שבה המיקרופון "דלוק" אך לא קולט דבר (וכך אבדו הודעות).
      const restart = (delay, lastTry) => setTimeout(() => {
        if (!session.wantOn) { if (onState) onState(false); return; }
        try { run(); }
        catch (_) {
          if (lastTry) { session.wantOn = false; toast("ההקלטה נעצרה · הטקסט נשמר בשדה, לחץ להמשיך"); if (onState) onState(false); }
          else restart(400, true);
        }
      }, delay);
      restart(150, false);
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
