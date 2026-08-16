// חדר המכונות בכיס (19/07): הלוח וההכרעות עוברים תמיד ב-Graph (graph.js), באותו
// צינור מאובטח שהלכידה משתמשת בו - בלי שום חשיפת-רשת של השרת המקומי. "המכונה
// בהישג יד" (v1, שהיה גוף renderEngine ב-app.js) עבר לכאן כרכיב עצמאי בראש העמוד:
// הוא בודק רשת מקומית (127.0.0.1:8861) ולא תלוי בטוקן - נשאר fetch ישיר ולא דרך
// graph.js בכוונה, כי זה בכלל לא Graph/OneDrive, זו בדיקת-נוכחות מול המכונה עצמה.
import { getDrivePathText, putDrivePathText } from "./graph.js";
import { CONFIG } from "./config.js";
import { toast, micButton } from "./ui.js";
// 16/08 (הדלפק היחיד): הכתיבה עברה ל-counter.js, שמנתב לפי מקור הפריט. הרינדור
// נשאר כאן. counter.js לא מייבא את engine.js, ולכן אין מעגל.
import { submitAnswer, canShowOptions, snoozeItem, filterSnoozed } from "./counter.js";

function mk(tag, cls, txt) { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }

function friendlyErr(e) {
  const m = (e && e.message) || "שגיאה לא ידועה";
  if (/403/.test(m)) return "אין הרשאה לגשת ללוח או לתיקיית ההכרעות · ייתכן שצריך להתחבר מחדש.";
  if (/401/.test(m)) return "החיבור פג · התחבר מחדש (לחץ על הצ'יפ 'התחבר' למעלה).";
  if (/Failed to fetch|NetworkError|network/i.test(m)) return "אין חיבור לרשת · בדוק את החיבור ונסה שוב.";
  return m;
}

function fmtStamp(iso, verb = "עודכן") {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${verb} ${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function autoGrow(ta) { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; }

function readJSON(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
}
function writeJSON(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* storage full/blocked - non-fatal */ }
}
function clearDraft(id) {
  const m = readJSON(DRAFT_KEY, {});
  if (id in m) { delete m[id]; writeJSON(DRAFT_KEY, m); }
}

// ---------- "המכונה בהישג יד" (v1, הועבר משם ללא שינוי התנהגות) ----------
const ENGINE_LOCAL = "http://127.0.0.1:8861";
export const ENGINE_PIPE = "http://almapm.tailfd019a.ts.net";
// בסיס לפתיחת החדר-החי: localhost כשעל המכונה, הצינור אחרת. brief.js (urgent-treat)
// מייבא את זה דינמית. משטח-הקידום עצמו לא צריך אותו - הוא קורא מהענן.
export async function engineBase() {
  try {
    const c = new AbortController(); const t = setTimeout(() => c.abort(), 1200);
    const r = await fetch(ENGINE_LOCAL + "/hub-data", { signal: c.signal, cache: "no-store" });
    clearTimeout(t); if (r.ok) return ENGINE_LOCAL;
  } catch { /* not on the machine */ }
  return ENGINE_PIPE;
}
// קישור אמיתי במקום window.open: ניווט טבעי לעולם לא נחסם בדפדפן נייד, וכשהיעד
// אינו נגיש הדפדפן מציג שגיאה משלו במקום טאב ריק ושקט. זה השורש של "דף מת" (28/07).
export function roomLink(base, label) {
  const a = mk("a", "btn-primary");
  a.textContent = label;
  a.href = base + "/hub";
  a.target = "_blank"; a.rel = "noopener";
  a.style.display = "inline-block"; a.style.textDecoration = "none";
  return a;
}

export async function renderLocalReach(container) {
  container.innerHTML = "";
  const box = mk("div", "card");
  const h = mk("div", "shead");
  h.appendChild(mk("span", "over", "המכונה בהישג יד"));
  h.appendChild(mk("span", "line"));
  box.appendChild(h);
  const status = mk("p", "muted", "בודק אם המכונה בהישג יד…");
  box.appendChild(status);
  container.appendChild(box);

  let up = false;
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 1500);
    const r = await fetch(ENGINE_LOCAL + "/hub-data", { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(t); up = r.ok;
  } catch { up = false; }

  status.remove();
  if (up) {
    const p = mk("p", "muted"); p.textContent = "המכונה בהישג יד. הדלפק, הלוח וההכרעות הנעולות - בלחיצה אחת.";
    box.appendChild(p); box.appendChild(roomLink(ENGINE_LOCAL, "פתח את חדר המכונות"));
  } else {
    // 28/07: הענף הזה היה מבוי סתום - הודיע "אין קו ישיר" ולא נתן שום דלת, כי הבדיקה
    // נעשית רק מול 127.0.0.1 שלא קיים בטלפון. הצינור הפרטי כן פתוח, ואי אפשר לבדוק
    // אותו מכאן (בית עלמא ב-https, הצינור ב-http, והדפדפן חוסם בדיקה כזו) - אז במקום
    // לנחש, נותנים קישור אמיתי ואומרים במפורש מה הוא דורש.
    const p1 = mk("p", "muted");
    p1.textContent = "חדר-המכונות רץ על המכונה בבית וסגור לרשת. מהמכשיר הזה אין קו ישיר, אבל הצינור הפרטי פתוח:";
    box.appendChild(p1);
    box.appendChild(roomLink(ENGINE_PIPE, "פתח דרך הצינור הפרטי"));
    box.appendChild(mk("p", "hint", ENGINE_PIPE.replace(/^https?:\/\//, "") + " · דורש שה-Tailscale בטלפון יהיה מחובר"));
  }
}

// ---------- לוח-הענן + הכרעות ----------
const DECIDED_KEY = "engine-decided";       // { [id]: {verdict, note, at} } - עד שהלוח כבר לא כולל את ה-id
const DRAFT_KEY = "engine-note-draft";      // { [id]: text } - טיוטת הערה, נמחקת אחרי שליחה מוצלחת

// 23/07 (עמוד-המענה "מה השאלה?"): ההכרעות המקומיות נחשפות גם ל-answer.js -
// אותו מפתח localStorage, כדי ששני הפנים (חדר-מלא / עמוד-מענה) לא יסתרו זה את זה.
export function localDecided() { return readJSON(DECIDED_KEY, {}); }

// סולם-העדיפויות (הכרעת 22/07): תג-מדרגה על כרטיס ממתין. שירות מעל מכונה, תמיד.
const TIER_HE = { 1: "אדם מחכה", 2: "ריצה חונה", 3: "שירות", 4: "מכונה" };
const ORIGIN_HE = { actions: "פעולות", qboard: "לוח", engine: "מנוע" };

function renderGuardLine(guard) {
  const wrap = mk("div", "eng-guard");
  [["red", "אדום", guard.red], ["amber", "כתום", guard.amber], ["green", "ירוק", guard.green]].forEach(([key, label, n]) => {
    const chip = mk("span", "eng-dot eng-dot-" + key);
    chip.appendChild(mk("span", "eng-dot-n", n == null ? "·" : String(n)));
    chip.appendChild(mk("span", "eng-dot-l", " " + label));
    wrap.appendChild(chip);
  });
  wrap.appendChild(mk("span", "eng-scan", guard.scannedAt ? fmtStamp(guard.scannedAt, "נסרק") : "לא נסרק עדיין"));
  return wrap;
}

// answer = { kind: "yes"|"no"|"option"|"text", option?, optionLabel?, note? }
function verdictLabel(answer) {
  if (answer.kind === "option") return [answer.option, answer.optionLabel].filter(Boolean).join(" · ");
  if (answer.kind === "yes") return "כן";
  if (answer.kind === "no") return "לא";
  return "נענה";
}

function markDecidedUI(row, answer, note, demo) {
  const ta = row.querySelector("textarea"); if (ta) ta.remove();
  const recRow = row.querySelector(".rec-row"); if (recRow) recRow.remove();
  const yn = row.querySelector(".eng-yn"); if (yn) yn.remove();
  const opts = row.querySelector(".eng-opts"); if (opts) opts.remove();
  const defer = row.querySelector(".eng-defer"); if (defer) defer.remove();
  const label = (demo ? "מצב הדגמה · " : "") + "נרשם: " + verdictLabel(answer) + (note ? " · ההערה שלך: " + note : "") + (demo ? "" : " · ממתין לעדכון בלוח");
  row.appendChild(mk("span", "locked-tag", label));
}

async function submitDecision(it, answer, ctx, row, buttons) {
  buttons.forEach((b) => { b.disabled = true; });
  const cleanNote = (answer.note || "").trim();
  const payload = { ...answer, note: cleanNote };

  if (ctx.demo) {
    clearDraft(it.id);
    markDecidedUI(row, answer, cleanNote, true);
    toast("מצב הדגמה · נרשם: " + verdictLabel(answer) + (cleanNote ? " · ההערה שלך: " + cleanNote : ""));
    return;
  }

  const res = await submitAnswer(it, payload, ctx);
  if (!res.ok) {
    buttons.forEach((b) => { b.disabled = false; });
    toast(res.stale ? res.error : "שליחת ההכרעה נכשלה · " + friendlyErr({ message: res.error }));
    return;
  }

  const decided = readJSON(DECIDED_KEY, {});
  decided[it.id] = { verdict: answer.kind, option: answer.option || "", note: cleanNote, at: new Date().toISOString() };
  writeJSON(DECIDED_KEY, decided);
  clearDraft(it.id);

  markDecidedUI(row, answer, cleanNote, false);
  toast("נרשם: " + verdictLabel(answer) + (cleanNote ? " · ההערה שלך: " + cleanNote : ""));
}

function renderAwaitingItem(it, ctx) {
  const row = mk("div", "thr");
  const already = ctx.decided[it.id];

  const head = mk("div", "thr-head-row"); head.style.cursor = "default";
  head.appendChild(mk("span", "sum", it.title || "(ללא כותרת)"));
  if (it.tier) head.appendChild(mk("span", "eng-tier t" + it.tier, TIER_HE[it.tier] || ""));
  // תג-מקור (16/08): הדלפק מציג שלושה מקורות, ואסף צריך לדעת על מה הוא עונה.
  if (ORIGIN_HE[it.origin]) head.appendChild(mk("span", "eng-origin", ORIGIN_HE[it.origin]));
  row.appendChild(head);

  if (it.detail) row.appendChild(mk("div", "thr-body", it.detail));
  if (it.recommendation) row.appendChild(mk("div", "thr-body eng-rec", "מומלץ: " + it.recommendation));

  if (already) {
    const what = already.option || (already.verdict === "yes" ? "כן" : already.verdict === "no" ? "לא" : "נענה");
    row.appendChild(mk("span", "locked-tag", "נרשם מקומית: " + what
      + (already.note ? " · " + already.note : "") + " · ממתין לעדכון בלוח"));
    return row;
  }

  // שדה הערה שגדל עם התוכן (בלי גלילה פנימית) + טיוטה נשמרת ל-localStorage תוך כדי הקלדה.
  const ta = mk("textarea", "ta-remark ta-grow"); ta.placeholder = "הערה (לא חובה)…"; ta.rows = 1;
  const drafts0 = readJSON(DRAFT_KEY, {});
  if (drafts0[it.id]) ta.value = drafts0[it.id];
  ta.addEventListener("input", () => {
    autoGrow(ta);
    const m = readJSON(DRAFT_KEY, {});
    if (ta.value.trim()) m[it.id] = ta.value; else delete m[it.id];
    writeJSON(DRAFT_KEY, m);
  });
  row.appendChild(ta);
  setTimeout(() => autoGrow(ta), 0);   // גובה נכון גם כשיש טיוטה שמולאה מראש

  const micRow = mk("div", "rec-row"); micRow.appendChild(micButton(ta)); row.appendChild(micRow);

  const btnRow = mk("div", "eng-yn");
  const yes = mk("button", "yes", "כן ✓"); yes.type = "button";
  const no = mk("button", "no", "לא ✗"); no.type = "button";
  btnRow.appendChild(yes); btnRow.appendChild(no);

  // שורת האותיות (16/08): מעל כן/לא, ורק כשיש אופציות וגם הצד השני יודע לקרוא
  // אותן. canShowOptions מסתיר אותה על פריטי engine עד שצרכן ה-inbox יכיר
  // verdict:"option" - עדיף כפתור שלא קיים מכפתור שנבלע בשקט.
  let optBtns = [];
  if (canShowOptions(it)) {
    const opts = mk("div", "eng-opts");
    opts.appendChild(mk("div", "eng-opts-lbl", "בחר אפשרות"));
    it.options.forEach((o) => {
      const key = o.key || "";
      const label = o.label || "";
      const b = mk("button", "opt", [key, label].filter(Boolean).join(" · ")); b.type = "button";
      b.addEventListener("click", () => submitDecision(it, { kind: "option", option: key, optionLabel: label, note: ta.value }, ctx, row, [...optBtns, yes, no]));
      optBtns.push(b); opts.appendChild(b);
    });
    // מעל שדה ההערה: הבחירה היא המסלול המהיר, וההערה היא התוספת האופציונלית.
    row.insertBefore(opts, ta);
  }

  yes.addEventListener("click", () => submitDecision(it, { kind: "yes", note: ta.value }, ctx, row, [...optBtns, yes, no]));
  no.addEventListener("click", () => submitDecision(it, { kind: "no", note: ta.value }, ctx, row, [...optBtns, yes, no]));
  row.appendChild(btnRow);

  // "לא עכשיו" (16/08): דחייה מקומית למכשיר בלבד. היא לא נכתבת לשום מקור ולא
  // מופיעה כקבלה - דחייה היא "לא עכשיו, לא כאן", לא הכרעה.
  const deferRow = mk("div", "eng-defer");
  const defer = mk("button", "iconbtn", "לא עכשיו"); defer.type = "button";
  defer.title = "יחזור מחר ב-07:00";
  defer.addEventListener("click", () => {
    snoozeItem(it.id);
    row.classList.add("snoozed-out");
    setTimeout(() => { row.remove(); if (ctx.onSnooze) ctx.onSnooze(); }, 180);
  });
  deferRow.appendChild(defer);
  const tts = mk("button", "iconbtn", "הקרא לי"); tts.type = "button";
  tts.addEventListener("click", () => speakItem(it));
  deferRow.appendChild(tts);
  row.appendChild(deferRow);

  return row;
}

let speaking = false;
function speakItem(it) {
  if (!("speechSynthesis" in window)) { toast("הדפדפן לא תומך בהקראה"); return; }
  if (speaking) { speechSynthesis.cancel(); speaking = false; return; }
  const txt = [it.title, it.detail, it.recommendation ? "מומלץ: " + it.recommendation : ""].filter(Boolean).join(". ");
  const u = new SpeechSynthesisUtterance(txt); u.lang = "he-IL";
  const v = speechSynthesis.getVoices().find((x) => x.lang && x.lang.startsWith("he")); if (v) u.voice = v;
  u.onend = () => { speaking = false; }; speaking = true; speechSynthesis.speak(u);
}

export function renderAwaitingSection(items, ctx) {
  const sec = mk("section");
  // דחייה מסננת כאן, ולא במקור: היא מקומית למכשיר לפי הכרעת 16/08.
  const { visible, snoozed } = filterSnoozed(items || []);

  const sh = mk("div", "shead");
  sh.appendChild(mk("span", "over", "ממתין לך"));
  sh.appendChild(mk("span", "line"));
  sh.appendChild(mk("span", "thr-count", visible.length ? String(visible.length) : "✓"));
  sec.appendChild(sh);

  if (!visible.length) {
    sec.appendChild(mk("div", "card empty", snoozed
      ? `אין מה לענות כרגע. ${snoozed} נדחו להיום ויחזרו מחר בבוקר.`
      : "אין החלטות שממתינות לך כרגע. ✓"));
    return sec;
  }

  const list = mk("div", "thr-list");
  visible.forEach((it) => {
    try { list.appendChild(renderAwaitingItem(it, ctx)); }
    catch (e) { list.appendChild(mk("div", "thr err-msg", "פריט לא תקין בלוח: " + (e.message || ""))); }
  });
  sec.appendChild(list);
  // מונה-דחיות גלוי: דחייה לא הופכת להיעלמות שקטה.
  if (snoozed) sec.appendChild(mk("p", "hint", `${snoozed} נדחו להיום · יחזרו מחר ב-07:00`));
  sec.appendChild(mk("p", "hint", "כן/לא/אות נשלחים מיד עם ההערה שלך (אם כתבת). ההכרעה מסומנת גם במכשיר הזה עד שהלוח יתעדכן."));
  return sec;
}

function renderLockedItem(it) {
  const row = mk("div", "thr locked");
  const head = mk("div", "thr-head-row"); head.style.cursor = "default";
  if (it.locked_at) head.appendChild(mk("span", "time ltr", fmtStamp(it.locked_at, "").trim()));
  head.appendChild(mk("span", "sum", it.title || "(ללא כותרת)"));
  row.appendChild(head);
  if (it.ruling) row.appendChild(mk("div", "thr-body", it.ruling));
  if (it.status_line) row.appendChild(mk("span", "locked-tag", it.status_line));
  return row;
}

function renderLockedSection(items, opts) {
  const folded = !!(opts && opts.folded) && items.length > 0;
  const sec = folded ? document.createElement("details") : mk("section");
  if (folded) {
    sec.style.marginTop = "12px";
    const sm = mk("summary", null, "הכרעות נעולות · " + items.length);
    sm.style.cursor = "pointer"; sm.style.color = "var(--txt-m)"; sm.style.padding = "8px 2px";
    sec.appendChild(sm);
  } else {
    const sh = mk("div", "shead");
    sh.appendChild(mk("span", "over", "הכרעות נעולות"));
    sh.appendChild(mk("span", "line"));
    sh.appendChild(mk("span", "thr-count", String(items.length)));
    sec.appendChild(sh);
  }

  if (!items.length) {
    sec.appendChild(mk("div", "card empty", "עוד אין הכרעות נעולות."));
    return sec;
  }

  const search = mk("input"); search.type = "text"; search.className = "tag-in";
  search.placeholder = "חיפוש בהכרעות…"; search.style.marginBottom = "10px";
  sec.appendChild(search);

  const list = mk("div", "thr-list");
  sec.appendChild(list);

  function paint(filterText) {
    list.innerHTML = "";
    const q = (filterText || "").trim().toLowerCase();
    const filtered = !q ? items : items.filter((it) => {
      const hay = [it.title, it.ruling, it.status_line].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
    if (!filtered.length) { list.appendChild(mk("div", "card empty", "אין תוצאות לחיפוש.")); return; }
    filtered.forEach((it) => {
      try { list.appendChild(renderLockedItem(it)); }
      catch (e) { list.appendChild(mk("div", "thr err-msg", "פריט לא תקין בלוח: " + (e.message || ""))); }
    });
  }
  search.addEventListener("input", () => paint(search.value));
  paint("");

  return sec;
}

function renderBoard(container, board, token, opts) {
  const demo = !!opts.demo;
  container.innerHTML = "";

  // פריט שהוכרע מקומית מסומן עד שהלוח הבא כבר לא יכיל אותו - כאן מנקים את מה שכבר נעלם.
  const decided = readJSON(DECIDED_KEY, {});
  if (!demo) {
    const awaitingIds = new Set((board.awaiting || []).map((a) => a.id));
    let changed = false;
    Object.keys(decided).forEach((id) => { if (!awaitingIds.has(id)) { delete decided[id]; changed = true; } });
    if (changed) writeJSON(DECIDED_KEY, decided);
  }

  const head = mk("div", "thr-head");
  head.appendChild(mk("span", "over", "חדר המכונות"));
  head.appendChild(mk("span", "thr-count", fmtStamp(board.updatedAt) || " "));
  container.appendChild(head);

  container.appendChild(renderGuardLine(board.guard || {}));
  container.appendChild(renderAwaitingSection(board.awaiting || [], { token, demo, decided }));
  // 22/07 (משוב אסף): הנעולות (closed) מקופלות - לא ערימה גדולה מעל הפתוחים.
  container.appendChild(renderLockedSection((board.locked || []).slice(0, 30), { folded: true }));

  if (demo) container.appendChild(mk("p", "hint", "מצב הדגמה - שינויים מקומיים בלבד, ללא כתיבה ל-OneDrive."));
}

// ---------- live ----------
export async function loadEngineBoard(token, container) {
  container.innerHTML = "";
  container.appendChild(mk("p", "muted pad", "טוען לוח…"));

  let raw;
  try {
    raw = await getDrivePathText(token, CONFIG.engineBoardPath);
  } catch (e) {
    container.innerHTML = "";
    container.appendChild(mk("p", "err-msg pad", "שגיאת טעינת הלוח: " + friendlyErr(e)));
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
    container.appendChild(mk("p", "err-msg pad", "הלוח שהתקבל מהענן אינו תקין (JSON שבור): " + (e.message || "")));
    return;
  }

  renderBoard(container, board, token, { demo: false });
}

// ---------- demo (no auth) ----------
const DEMO_BOARD = {
  updatedAt: new Date().toISOString(),
  guard: { red: 0, amber: 1, green: 6, scannedAt: new Date().toISOString() },
  awaiting: [
    { id: "demo-1", title: "לפרסם את גרסת-הכיס של חדר המכונות?",
      detail: "לוח + הכרעות דרך הענן (OneDrive/Graph), בלי חשיפת רשת של השרת המקומי.",
      recommendation: "כן - הצינור זהה ללכידה, כבר מאובטח." },
  ],
  locked: [
    { id: "demo-l1", title: "לרכוש שרת N100?", locked_at: new Date(Date.now() - 13 * 86400000).toISOString(),
      ruling: "נדחה - עובדים על הקיימת.", status_line: "הוכרע 06/07" },
  ],
};
export function loadEngineBoardDemo(container) {
  renderBoard(container, DEMO_BOARD, null, { demo: true });
}

// ---------- מעבר-עיניים (טלפון, 19/07 - גשר-הענן השני) ----------
// אותו דפוס בדיוק כמו הלוח למעלה: קורא eyes-pass.json שהמנצח מפרסם, כותב קובץ
// חדש לכל פסיקה לאותה תיקיית inbox (CONFIG.engineInboxPath) - שם קובץ eyes-*.json
// כדי לא להתנגש עם decide-*.json של הלוח. פסיקה כאן היא טקסט חופשי, לא כן/לא.
const EYES_DECIDED_KEY = "eyes-decided";    // { [id]: {verdict, at} } - עד שהפריט מסומן decided בענן או נעלם
const EYES_DRAFT_KEY = "eyes-note-draft";   // { [id]: text } - טיוטת פסיקה, נמחקת אחרי שליחה מוצלחת

function clearEyesDraft(id) {
  const m = readJSON(EYES_DRAFT_KEY, {});
  if (id in m) { delete m[id]; writeJSON(EYES_DRAFT_KEY, m); }
}

function markEyesDecidedUI(row, verdict, fromCloud, demo) {
  const ta = row.querySelector("textarea"); if (ta) ta.remove();
  const micRow = row.querySelector(".rec-row"); if (micRow) micRow.remove();
  const send = row.querySelector(".commit"); if (send) send.remove();
  const label = (demo ? "מצב הדגמה · " : "") + "נפסק: " + verdict + (fromCloud || demo ? "" : " · ממתין לעדכון");
  row.appendChild(mk("span", "locked-tag", label));
}

async function submitEyesVerdict(it, ta, token, row, btn) {
  const verdict = (ta.value || "").trim();
  if (!verdict) { toast("כתוב פסיקה לפני שליחה"); return; }
  btn.disabled = true;

  const at = new Date().toISOString();
  const payload = { kind: "eyes-verdict", id: it.id, verdict, at, src: "phone" };
  const fname = `eyes-${Date.now()}-${it.id}.json`;
  try {
    await putDrivePathText(token, `${CONFIG.engineInboxPath}/${fname}`, JSON.stringify(payload, null, 2));
  } catch (e) {
    btn.disabled = false;
    toast("שליחת הפסיקה נכשלה · " + friendlyErr(e));
    return;
  }

  const decided = readJSON(EYES_DECIDED_KEY, {});
  decided[it.id] = { verdict, at };
  writeJSON(EYES_DECIDED_KEY, decided);
  clearEyesDraft(it.id);

  markEyesDecidedUI(row, verdict, false, false);
  toast("נשלח: " + verdict);
}

function renderEyesItem(it, ctx) {
  const row = mk("div", "thr");
  const already = it.decided || ctx.decided[it.id];

  const head = mk("div", "thr-head-row"); head.style.cursor = "default";
  const label = (it.n != null ? it.n + ". " : "") + (it.title || "(ללא כותרת)");
  head.appendChild(mk("span", "sum", label));
  row.appendChild(head);

  if (it.decide) row.appendChild(mk("div", "thr-body", it.decide));

  if (already) {
    const fromCloud = !!it.decided;
    const tag = "נפסק: " + (already.verdict || "")
      + (already.at ? " · " + fmtStamp(already.at, "").trim() : "")
      + (fromCloud ? "" : " · ממתין לעדכון");
    row.appendChild(mk("span", "locked-tag", tag));
    return row;
  }

  if (it.prefillNote) row.appendChild(mk("div", "thr-body eng-rec", it.prefillNote));

  // אותו דפוס טופס כמו בלוח למעלה: שדה שגדל עם התוכן + טיוטה נשמרת ל-localStorage
  // תוך כדי הקלדה, עם ה-prefill כברירת מחדל (טיוטה קיימת גוברת עליו).
  const ta = mk("textarea", "ta-remark ta-grow"); ta.placeholder = "הפסיקה שלך…"; ta.rows = 1;
  const drafts0 = readJSON(EYES_DRAFT_KEY, {});
  ta.value = (it.id in drafts0) ? drafts0[it.id] : (it.prefill || "");
  ta.addEventListener("input", () => {
    autoGrow(ta);
    const m = readJSON(EYES_DRAFT_KEY, {});
    if (ta.value.trim()) m[it.id] = ta.value; else delete m[it.id];
    writeJSON(EYES_DRAFT_KEY, m);
  });
  row.appendChild(ta);
  setTimeout(() => autoGrow(ta), 0);   // גובה נכון גם כשיש טיוטה/prefill שמולאו מראש

  const micRow = mk("div", "rec-row"); micRow.appendChild(micButton(ta)); row.appendChild(micRow);

  const send = mk("button", "commit", "שלח פסיקה"); send.type = "button";
  send.addEventListener("click", () => {
    if (ctx.demo) {
      const verdict = (ta.value || "").trim();
      if (!verdict) { toast("כתוב פסיקה לפני שליחה"); return; }
      clearEyesDraft(it.id);
      markEyesDecidedUI(row, verdict, false, true);
      toast("מצב הדגמה · נשלח: " + verdict);
      return;
    }
    submitEyesVerdict(it, ta, ctx.token, row, send);
  });
  row.appendChild(send);

  return row;
}

function renderEyes(container, data, token, opts) {
  const demo = !!opts.demo;
  container.innerHTML = "";
  const items = data.items || [];

  // פריט שהוכרע מקומית מסומן עד שהוא מסומן decided בענן או נעלם מהרשימה.
  const decided = readJSON(EYES_DECIDED_KEY, {});
  if (!demo) {
    const openIds = new Set(items.filter((it) => !it.decided).map((it) => it.id));
    let changed = false;
    Object.keys(decided).forEach((id) => { if (!openIds.has(id)) { delete decided[id]; changed = true; } });
    if (changed) writeJSON(EYES_DECIDED_KEY, decided);
  }

  const sh = mk("div", "shead");
  sh.appendChild(mk("span", "over", "מעבר-עיניים"));
  sh.appendChild(mk("span", "line"));
  sh.appendChild(mk("span", "thr-count", items.length ? String(items.length) : "✓"));
  container.appendChild(sh);
  if (data.updatedAt) container.appendChild(mk("p", "eng-scan", fmtStamp(data.updatedAt)));

  if (!items.length) {
    container.appendChild(mk("div", "card empty", "אין פסיקות ממתינות במעבר-העיניים כרגע. ✓"));
  } else {
    const list = mk("div", "thr-list");
    items.forEach((it) => {
      try { list.appendChild(renderEyesItem(it, { token, demo, decided })); }
      catch (e) { list.appendChild(mk("div", "thr err-msg", "פריט לא תקין במעבר-העיניים: " + (e.message || ""))); }
    });
    container.appendChild(list);
    container.appendChild(mk("p", "hint", "הפסיקה נשלחת כטקסט חופשי, בלי כן/לא · המכונה תפרש אותה בהמשך."));
  }

  if (demo) container.appendChild(mk("p", "hint", "מצב הדגמה - שינויים מקומיים בלבד, ללא כתיבה ל-OneDrive."));
}

// ---------- live ----------
export async function loadEyesPass(token, container) {
  container.innerHTML = "";
  container.appendChild(mk("p", "muted pad", "טוען מעבר-עיניים…"));

  let raw;
  try {
    raw = await getDrivePathText(token, CONFIG.eyesPassPath);
  } catch (e) {
    container.innerHTML = "";
    container.appendChild(mk("p", "err-msg pad", "שגיאת טעינת מעבר-העיניים: " + friendlyErr(e)));
    return;
  }

  if (raw == null) {
    container.innerHTML = "";
    container.appendChild(mk("div", "card empty", "מעבר-העיניים יופיע כשהמכונה תפרסם."));
    return;
  }

  let data;
  try { data = JSON.parse(raw); }
  catch (e) {
    container.innerHTML = "";
    container.appendChild(mk("p", "err-msg pad", "מעבר-העיניים שהתקבל מהענן אינו תקין (JSON שבור): " + (e.message || "")));
    return;
  }

  renderEyes(container, data, token, { demo: false });
}

// ---------- demo (no auth) ----------
const DEMO_EYES = {
  updatedAt: new Date().toISOString(),
  items: [
    { id: "demo-eyes-1", n: 1, title: "לפרסם את הפוסט על הריל של אינסטגרם?",
      decide: "לפרסם כמו שהוא, לערוך, או לדחות?",
      prefill: "לפרסם כמו שהוא", prefillNote: "מומלץ: לפרסם כמו שהוא - הטון תואם.",
      decided: null },
    { id: "demo-eyes-2", n: 2, title: "לאשר את נוסח ההודעה לגליל?",
      decide: "לאשר, לתקן, או לדחות?", prefill: "", prefillNote: "",
      decided: { verdict: "אושר עם תיקון קל בפתיח", at: new Date(Date.now() - 3600000).toISOString() } },
  ],
};
export function loadEyesPassDemo(container) {
  renderEyes(container, DEMO_EYES, null, { demo: true });
}

// ---------- הנול (טלפון, 19/07 - גשר-הענן השלישי, קריאה-בלבד) ----------
// אותו דפוס קריאה כמו הלוח/מעבר-העיניים: קורא loom-summary.json שהמנצח מפרסם.
// שונה מהם באחד: קריאה-בלבד לחלוטין - אין טופס, אין מיקרופון, אין שליחה, אין נתיב-
// כתיבה חוזר. עיקרון P2 (הגלם קדוש): הכרטיס נושא כותרת + סטטוס-תחנות + רלוונטיות
// בלבד, בלי transcript/summary. פריטים רגישים (AdinVeod/D4) סוננו כבר בשרת.
const STATE_DOT = { ok: "green", warn: "amber", bad: "red" };
const LOOM_STATUS_HE = { live: "חי", needs: "ממתין להכרעה", resolved: "הוכרע", superseded: "הוחלף", stale: "ישן", done: "הושלם" };

function loomCountsStrip(counts) {
  const wrap = mk("div", "eng-guard");
  [["green", "חי", counts.live], ["amber", "טרי", counts.fresh], ["red", "תקוע", counts.stuck], ["green", "נותב", counts.routed]]
    .forEach(([key, label, n]) => {
      const chip = mk("span", "eng-dot eng-dot-" + key);
      chip.appendChild(mk("span", "eng-dot-n", n == null ? "·" : String(n)));
      chip.appendChild(mk("span", "eng-dot-l", " " + label));
      wrap.appendChild(chip);
    });
  return wrap;
}

function renderLoomItem(it, ctx) {
  const row = mk("div", "thr");
  const head = mk("div", "thr-head-row"); head.style.cursor = "default";
  if (it.ageDays != null) head.appendChild(mk("span", "time ltr", it.ageDays + "d"));
  head.appendChild(mk("span", "sum", it.title || "(ללא כותרת)"));
  row.appendChild(head);

  if (it.focus) row.appendChild(mk("span", "locked-tag", "● במוקד - החוט הבא"));
  if (it.relevance && it.relevance.reason) row.appendChild(mk("div", "thr-body eng-rec", it.relevance.reason));

  const meta = [];
  if (it.relevance && it.relevance.status) meta.push(LOOM_STATUS_HE[it.relevance.status] || it.relevance.status);
  if (it.stations && it.stations.lifecycleNote) meta.push(it.stations.lifecycleNote);
  if (it.vault) meta.push("וולט: " + it.vault);
  if (meta.length) row.appendChild(mk("div", "thr-body muted", meta.join(" · ")));

  // 22/07 (משוב אסף - "long board, nothing to do"): הנול אינטראקטיבי. כל חוט-דורש
  // נשלח להכרעה מהטלפון (השאר/ארכב + הערה) → inbox, המחשב מעכל. חוטים מקופלים
  // (ישנים/טופלו) נשארים קריאה-בלבד: ctx.interactive=false.
  if (!ctx || !ctx.interactive) return row;

  const already = (ctx.decided || {})[it.id];
  if (already) {
    row.appendChild(mk("span", "locked-tag", "נרשם: " + (already.verdict === "yes" ? "השאר" : "ארכב")
      + (already.note ? " · " + already.note : "") + " · ממתין לעיבוד"));
    return row;
  }

  const ta = mk("textarea", "ta-remark ta-grow"); ta.placeholder = "הערה (לא חובה)…"; ta.rows = 1;
  const d0 = readJSON(DRAFT_KEY, {}); if (d0[it.id]) ta.value = d0[it.id];
  ta.addEventListener("input", () => {
    autoGrow(ta);
    const m = readJSON(DRAFT_KEY, {}); if (ta.value.trim()) m[it.id] = ta.value; else delete m[it.id]; writeJSON(DRAFT_KEY, m);
  });
  row.appendChild(ta); setTimeout(() => autoGrow(ta), 0);
  const micRow = mk("div", "rec-row"); micRow.appendChild(micButton(ta)); row.appendChild(micRow);

  const btnRow = mk("div", "eng-yn");
  const keep = mk("button", "yes", "השאר ✓"); keep.type = "button";
  const arch = mk("button", "no", "ארכב ✗"); arch.type = "button";
  keep.addEventListener("click", () => submitDecision(it, "yes", ta.value, ctx, row, [keep, arch]));
  arch.addEventListener("click", () => submitDecision(it, "no", ta.value, ctx, row, [keep, arch]));
  btnRow.appendChild(keep); btnRow.appendChild(arch); row.appendChild(btnRow);
  return row;
}

function renderLoom(container, data, opts) {
  const demo = !!(opts && opts.demo);
  const token = opts && opts.token;
  container.innerHTML = "";
  const counts = data.counts || {};
  const cards = data.cards || [];
  const ctx = { token, demo, decided: readJSON(DECIDED_KEY, {}), interactive: true };

  const sh = mk("div", "shead");
  sh.appendChild(mk("span", "over", "הנול"));
  sh.appendChild(mk("span", "line"));
  container.appendChild(sh);
  if (data.updatedAt) container.appendChild(mk("p", "eng-scan", fmtStamp(data.updatedAt)));

  if (!cards.length) {
    container.appendChild(mk("div", "card empty", "אין חוטים כרגע."));
    if (demo) container.appendChild(mk("p", "hint", "מצב הדגמה."));
    return;
  }

  // 22/07 (משוב אסף): שלוש קבוצות - דורשי-הכרעה בראש (אינטראקטיביים), ישנים
  // וטופלו מקופלים. במקום "long board" של 199 קריאה-בלבד.
  const life = (c) => (c.stations || {}).lifecycle;
  const stat = (c) => (c.relevance || {}).status;
  const isPending = (c) => c.focus || life(c) === "warn" || life(c) === "bad" || stat(c) === "needs";
  const isStale = (c) => !isPending(c) && stat(c) === "stale";
  const pending = cards.filter(isPending);
  const stale = cards.filter(isStale);
  const done = cards.filter((c) => !isPending(c) && !isStale(c));

  const hd = mk("p", "hint"); hd.style.fontWeight = "600"; hd.style.marginTop = "8px";
  hd.textContent = "דורשים הכרעה · " + pending.length;
  container.appendChild(hd);
  const list = mk("div", "thr-list"); container.appendChild(list);
  if (pending.length) pending.forEach((c) => { try { list.appendChild(renderLoomItem(c, ctx)); } catch (e) { list.appendChild(mk("div", "thr err-msg", "כרטיס לא תקין")); } });
  else list.appendChild(mk("div", "card empty", "אין חוטים שדורשים הכרעה. הכל זורם."));

  const foldGroup = (title, arr) => {
    if (!arr.length) return;
    const det = document.createElement("details"); det.style.marginTop = "12px";
    const sm = mk("summary", null, title + " · " + arr.length);
    sm.style.cursor = "pointer"; sm.style.color = "var(--txt-m)"; sm.style.padding = "8px 2px";
    det.appendChild(sm);
    const l = mk("div", "thr-list"); arr.forEach((c) => { try { l.appendChild(renderLoomItem(c, { interactive: false })); } catch (e) {} }); det.appendChild(l);
    container.appendChild(det);
  };
  foldGroup("ישנים · שקול לארכב", stale);
  foldGroup("בצינור / טופלו", done);
  if (counts.hiddenSensitive) container.appendChild(mk("p", "hint", counts.hiddenSensitive + " חוטים רגישים לא יוצאים מהמכונה"));
  if (demo) container.appendChild(mk("p", "hint", "מצב הדגמה."));
}

// ---------- live ----------
export async function loadLoom(token, container) {
  container.innerHTML = "";
  container.appendChild(mk("p", "muted pad", "טוען את הנול…"));

  let raw;
  try {
    raw = await getDrivePathText(token, CONFIG.loomSummaryPath);
  } catch (e) {
    container.innerHTML = "";
    container.appendChild(mk("p", "err-msg pad", "שגיאת טעינת הנול: " + friendlyErr(e)));
    return;
  }

  if (raw == null) {
    container.innerHTML = "";
    container.appendChild(mk("div", "card empty", "הנול יופיע כשהמכונה תפרסם."));
    return;
  }

  let data;
  try { data = JSON.parse(raw); }
  catch (e) {
    container.innerHTML = "";
    container.appendChild(mk("p", "err-msg pad", "הנול שהתקבל מהענן אינו תקין (JSON שבור): " + (e.message || "")));
    return;
  }

  renderLoom(container, data, { demo: false, token });
}

// ---------- demo (no auth) ----------
const DEMO_LOOM = {
  updatedAt: new Date().toISOString(),
  counts: { total: 3, run20: 1, fresh: 2, stuck: 1, decided: 1, routed: 0, live: 2, hiddenSensitive: 2 },
  focus: "demo-a",
  cards: [
    { id: "demo-a", title: "Jazz Kisa: בר ג'אז להוספה לרשימת המקומות", kind: "link", ageDays: 1, vault: "alma-r",
      focus: true, relevance: { status: "live", reason: "" },
      stations: { klita: "ok", ibud: "ok", lifecycle: "warn", lifecycleNote: "ממתין" } },
    { id: "demo-b", title: "ריל על מערכות אישיות מסתגלות", kind: "reel", ageDays: 7, vault: null,
      focus: false, relevance: { status: "stale", reason: "ישן (7 ימים), בלי קריאה" },
      stations: { klita: "ok", ibud: "warn", lifecycle: "bad", lifecycleNote: "תקוע 7 ימים" } },
    { id: "demo-c", title: "שאלה על ארכיטקטורת הוולטים", kind: "text", ageDays: 2, vault: "alma-r",
      focus: false, relevance: { status: "resolved", reason: "הוכרע, ממתין לעיבוד" },
      stations: { klita: "ok", ibud: "ok", lifecycle: "ok", lifecycleNote: "הוכרע · ממתין לעיבוד שלי" } },
  ],
};
export function loadLoomDemo(container) {
  renderLoom(container, DEMO_LOOM, { demo: true });
}
