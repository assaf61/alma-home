// Actions lane - the 4th leg. Closes the loop: capture→enrich→triage→file→ACT→report.
// Reads/writes Alma.R\00-system\actions.md via Graph. Full CRUD (Assaf asked for max
// flexibility: add / edit / delete / status / note / back). Three lanes:
//   ממתין לך  (owner:assaf, not done)  ·  המכונה  (owner:machine, todo/doing)  ·  נעשה (done)
// The machine does the safe autonomous items (research/web/draft/internal) during a
// Claude session and writes the result here; owner:assaf items wait for you.
import { getDrivePathText, putDrivePathText, createCalendarEvent } from "./graph.js";
import { CONFIG } from "./config.js";
import { toast, micButton } from "./ui.js";

// zi5i: calendar adder, set per board (live = real Graph write, demo = stub).
// Module-level because only one actions board is mounted at a time.
let calendarAdd = async () => { toast("התחבר כדי להוסיף ליומן"); };

const MARKER = "<!-- פעולות חדשות - הוסף מתחת לשורה הזו -->";
const OWNER_HE = { machine: "מכונה", assaf: "אתה" };
const STATUS_HE = { todo: "לעשות", doing: "בתנועה", done: "נעשה", waiting: "ממתין לך" };
// 16/08/2026 - זנב-המרקר. 39 מתוך 75 הפריטים בקובץ נושאים מזהה אחרי הסטטוס
// (`<!-- owner:machine status:todo qboard-swallowed-lines -->`), והביטוי הקודם דרש
// `-->` מיד אחרי הסטטוס ולכן לא תפס אותם כלל. התוצאה הייתה כפולה: הבעלים והסטטוס
// האמיתיים נזרקו וכל פריט כזה נקרא machine/todo, והמרקר המקורי נשאר בתוך הטקסט
// כך שכל שמירה הדביקה לו מרקר שני. הזנב נתפס עכשיו בקבוצה שלישית ונכתב בחזרה.
const MARK_RE = /<!--\s*owner:(\w+)\s+status:(\w+)([^>]*?)\s*-->/;

function mk(tag, cls, txt) { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
function todayISO() { const d = new Date(); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }

// ---- parse actions.md (below the marker) into a flat model ----
export function splitHead(text) {
  const i = (text || "").indexOf(MARKER);
  if (i < 0) return { head: (text || "").replace(/\s*$/, "") + "\n\n" + MARKER, body: "" };
  return { head: text.slice(0, i + MARKER.length), body: text.slice(i + MARKER.length) };
}
// 16/08/2026 - שימור-שורות. הגרסה הקודמת של serialize בנתה את הקובץ מחדש רק
// מהפריטים שהפרסר ידע למדל, ולכן כל שורה אחרת מתחת למרקר נמחקה בשמירה: פרוזה,
// כותרות-משנה, שורות-קבלה, שורות ריקות. במבחן-הסתירה של 16/08 תשובה אחת בדלפק
// מחקה שש שורות ממצאים שנכתבו ב-15/08. בצירוף עיוורון-ה-CRLF זה היה גרוע יותר:
// פרסר שרואה אפס פריטים היה גורם לשמירה למחוק את כל גוף הקובץ ולהשאיר רק את הראש.
// לכן כל שורה שאיננה פריט נשמרת עכשיו כפי-שהיא וממוקמת יחסית לפריט שאליו הצמדה:
// _before = מה שקדם לפריט (כולל שורת ה-## שלו), _after = מה שבא אחריו.
// serialize משחזר את הסדר המקורי במקום לקבץ מחדש, ומייצר כותרת חדשה רק לפריט
// שנוסף ואין לו כותרת משלו.
export function parseBody(body) {
  const lines = (body || "").split("\n");
  const items = []; let cur = { date: todayISO(), source: "" }; let last = null;
  let pending = [];   // שורות שטרם הוצמדו לפריט
  // כותרת `###` פותחת בלוק-נרטיב (ממצא, סיכום, שורת-קבלה), והבלוק נסגר בכותרת
  // `##` הבאה שהיא היחידה שפותחת קבוצת-פעולות. תבליט בתוך בלוק כזה הוא פרוזה
  // ולא פעולה - אלא אם הוא נושא מרקר. המרקר הוא ההצהרה המפורשת של הכותב שזו
  // פעולה, והוא גובר: מתוך 11 התבליטים שבבלוקי-הנרטיב ב-16/08, שמונה נושאים
  // מרקר ושלושה מהם ממתינים לאסף. פסילה לפי מיקום בלבד הייתה מסתירה אותם.
  let narrative = false;
  for (const line of lines) {
    if (/^#{3,}\s/.test(line)) { narrative = true; if (last) last._after.push(line); else pending.push(line); continue; }
    const hm = line.match(/^##\s+(.*)$/);
    if (hm) {
      narrative = false;
      const parts = hm[1].split("|").map((p) => p.trim());
      const dm = hm[1].match(/(\d{4}-\d{2}-\d{2})/);
      const sm = hm[1].match(/\[\[([^\]]+)\]\]/);
      cur = { date: dm ? dm[1] : todayISO(), source: sm ? sm[1] : (parts[parts.length - 1] || "") };
      pending.push(line); last = null; continue;
    }
    const rm = line.match(/^\s+- \*\*תוצאה:\*\*\s*(.*)$/);
    if (rm && last) { last.result = rm[1].trim(); continue; }
    const qm = (narrative && !MARK_RE.test(line)) ? null : line.match(/^- (.*)$/);
    if (qm) {
      const full = qm[1];
      const mk2 = full.match(MARK_RE);
      const owner = mk2 ? mk2[1] : "machine";
      const status = mk2 ? mk2[2] : "todo";
      const tag = mk2 ? (mk2[3] || "").trim() : "";
      const text = full.replace(MARK_RE, "").trim();
      last = { date: cur.date, source: cur.source, text, owner, status, tag, result: "", _before: pending, _after: [] };
      pending = [];
      items.push(last); continue;
    }
    if (last) last._after.push(line); else pending.push(line);
  }
  // פרוזה בזנב הקובץ שאין אחריה פריט. נשמרת על המערך עצמו כדי לא לשנות חתימה.
  items._tail = pending;
  return items;
}
export function serialize(head, items) {
  const out = []; let curKey = null;
  (items || []).forEach((it) => {
    const key = it.date + "|" + it.source;
    if (it._before && it._before.length) out.push(...it._before);
    else if (key !== curKey) out.push("", `## ${it.date} | [[${it.source || "כללי"}]]`);
    curKey = key;
    out.push(`- ${it.text}  <!-- owner:${it.owner} status:${it.status}${it.tag ? " " + it.tag : ""} -->`);
    if (it.result && it.result.trim()) out.push(`  - **תוצאה:** ${it.result.trim()}`);
    if (it._after && it._after.length) out.push(...it._after);
  });
  if (items && items._tail && items._tail.length) out.push(...items._tail);
  return head + out.join("\n");
}

export function laneOf(it) { return it.status === "done" ? "done" : (it.owner === "assaf" ? "you" : "machine"); }

let speaking = false;
function speak(txt) {
  if (!("speechSynthesis" in window)) { toast("הדפדפן לא תומך בהקראה"); return; }
  if (speaking) { speechSynthesis.cancel(); speaking = false; return; }
  const u = new SpeechSynthesisUtterance(txt); u.lang = "he-IL";
  const v = speechSynthesis.getVoices().find((x) => x.lang && x.lang.startsWith("he")); if (v) u.voice = v;
  u.onend = () => { speaking = false; }; speaking = true; speechSynthesis.speak(u);
}

// ---- a board instance: model + head + a save() that persists + re-renders ----
function makeBoard(container, head, items, save) {
  function rerender() { render(container, head, items, save, rerender); }
  rerender();
}

function render(container, head, items, save, rerender) {
  container.innerHTML = "";
  const h = mk("div", "thr-head");
  h.appendChild(mk("span", "over", "נתיב הפעולות"));
  const youN = items.filter((i) => laneOf(i) === "you").length;
  const mN = items.filter((i) => laneOf(i) === "machine").length;
  h.appendChild(mk("span", "thr-count", `${youN} ממתין לך · ${mN} במכונה`));
  container.appendChild(h);

  // + add
  const addBtn = mk("button", "btn-ghost", "+ הוסף משימה"); addBtn.style.marginBottom = "6px";
  addBtn.addEventListener("click", () => openAdd(container, items, save, rerender));
  container.appendChild(addBtn);

  const lanes = [["you", "ממתין לך"], ["machine", "המכונה עושה"], ["done", "נעשה"]];
  lanes.forEach(([key, label]) => {
    const inLane = items.filter((i) => laneOf(i) === key);
    if (!inLane.length) return;
    const sec = mk("section");
    const sh = mk("div", "shead"); sh.appendChild(mk("span", "over", label)); sh.appendChild(mk("span", "line")); sec.appendChild(sh);
    const list = mk("div", "thr-list");
    // 16/08 (דוקטרינת הדלפק-היחיד, הכרעת 23/07 שנשחקה): מסלול "ממתין לך" מאבד את
    // כפתורי-הניהול והופך לתצוגה שמנווטת לדלפק. שני המסלולים האחרים לא נגעו -
    // ערוך/תוצאה/יומן/ארכב הם פעלים נכונים על עבודת-מכונה ועל מה שנעשה.
    if (key === "you") {
      inLane.forEach((it) => list.appendChild(waitingRow(it)));
      sec.appendChild(list);
      const go = mk("button", "commit", `ענה על ${inLane.length} בדלפק ←`); go.type = "button";
      go.style.width = "100%"; go.style.marginTop = "8px";
      go.addEventListener("click", () => { location.hash = "#answer"; });
      sec.appendChild(go);
      container.appendChild(sec);
      return;
    }
    inLane.forEach((it) => list.appendChild(card(it, items, save, rerender)));
    sec.appendChild(list); container.appendChild(sec);
  });

  if (!items.length) container.appendChild(mk("div", "card empty", "אין פעולות פתוחות. ✓"));
  container.appendChild(mk("p", "hint", "המכונה מבצעת לבד את הבטוחות (מחקר/web/פנימי) וכותבת תוצאה כאן. מה שממתין לך נענה בדלפק (\"מה השאלה?\"); עבודת-המכונה ומה שנעשה ניתנים לעריכה כאן."));
}

// שורת "ממתין לך": תצוגה בלבד. המענה קורה בדלפק, ולא בשני מקומות שמתחרים.
function waitingRow(it) {
  const row = mk("div", "thr");
  const top = mk("div", "thr-head-row"); top.style.cursor = "default";
  if (it.source) top.appendChild(mk("span", "time ltr", it.source));
  top.appendChild(mk("span", "sum", it.text));
  row.appendChild(top);
  if (it.result && it.result.trim()) {
    const r = mk("div", "thr-text"); r.appendChild(mk("div", "thr-body", "תוצאה: " + it.result));
    row.appendChild(r);
  }
  return row;
}

function card(it, items, save, rerender) {
  const row = mk("div", "thr");
  const top = mk("div", "thr-head-row"); top.style.cursor = "default";
  top.appendChild(mk("span", "kind", OWNER_HE[it.owner] || it.owner));
  top.appendChild(mk("span", "time ltr", STATUS_HE[it.status] || it.status));
  if (it.source) top.appendChild(mk("span", "time ltr", it.source));
  top.appendChild(mk("span", "sum", it.text));
  row.appendChild(top);

  if (it.result && it.result.trim()) {
    const r = mk("div", "thr-text"); r.appendChild(mk("div", "thr-body", "תוצאה: " + it.result));
    row.appendChild(r);
  }

  const acts = mk("div", "rec-row"); acts.style.flexWrap = "wrap"; acts.style.gap = "6px"; acts.style.marginTop = "8px";
  const tts = mk("button", "iconbtn", "🔊"); tts.type = "button"; tts.title = "הקרא"; tts.addEventListener("click", () => speak(it.text + ". " + (it.result || ""))); acts.appendChild(tts);

  if (it.status !== "done") {
    const done = mk("button", "iconbtn", "✓ נעשה"); done.type = "button";
    done.addEventListener("click", () => { it.status = "done"; save(items); rerender(); }); acts.appendChild(done);
  } else {
    // ou1e: respond to a machine answer, or archive it off the active list.
    const reply = mk("button", "iconbtn", "💬 תגובה"); reply.type = "button";
    reply.addEventListener("click", () => replyBox(row, it, items, save, rerender)); acts.appendChild(reply);
    const back = mk("button", "iconbtn", "↶ החזר"); back.type = "button";
    back.addEventListener("click", () => { it.status = it.owner === "assaf" ? "waiting" : "todo"; save(items); rerender(); }); acts.appendChild(back);
    const arch = mk("button", "iconbtn", "🗄 ארכב"); arch.type = "button"; arch.title = "הסר מהרשימה הפעילה";
    arch.addEventListener("click", () => { const i = items.indexOf(it); if (i >= 0) items.splice(i, 1); save(items); rerender(); }); acts.appendChild(arch);
  }

  const edit = mk("button", "iconbtn", "✎ ערוך"); edit.type = "button";
  edit.addEventListener("click", () => inlineEdit(row, it, "text", "ערוך פעולה", items, save, rerender)); acts.appendChild(edit);

  const note = mk("button", "iconbtn", it.result ? "✎ תוצאה" : "+ תוצאה/הערה"); note.type = "button";
  note.addEventListener("click", () => inlineEdit(row, it, "result", "תוצאה / הערה / החלטה", items, save, rerender)); acts.appendChild(note);

  // zi5i: add this action to the calendar (prefilled from its text).
  const cal = mk("button", "iconbtn", "➕ ליומן"); cal.type = "button"; cal.title = "צור אירוע ביומן";
  cal.addEventListener("click", () => calBox(row, it)); acts.appendChild(cal);

  const del = mk("button", "iconbtn", "🗑"); del.type = "button"; del.title = "מחק";
  del.addEventListener("click", () => { if (confirm("למחוק את הפעולה?")) { const i = items.indexOf(it); if (i >= 0) items.splice(i, 1); save(items); rerender(); } });
  acts.appendChild(del);

  row.appendChild(acts);
  return row;
}

// ou1e: a free-text reply / decision on an answered action (with voice dictation).
function replyBox(row, it, items, save, rerender) {
  const box = mk("div"); box.style.marginTop = "8px";
  box.appendChild(mk("span", "lbl", "תגובה / החלטה"));
  const ta = mk("textarea", "ta-remark"); ta.placeholder = "מה להוסיף / להחליט בעקבות התשובה..."; box.appendChild(ta);
  const rr = mk("div", "rec-row"); rr.appendChild(micButton(ta));
  const ok = mk("button", "iconbtn", "שמור תגובה"); ok.type = "button";
  ok.addEventListener("click", () => {
    const t = ta.value.trim();
    if (t) it.result = (it.result ? it.result + " · " : "") + "תגובתך: " + t;
    save(items); rerender();
  });
  const cancel = mk("button", "iconbtn", "ביטול"); cancel.type = "button";
  cancel.addEventListener("click", () => rerender());
  rr.appendChild(ok); rr.appendChild(cancel); box.appendChild(rr);
  row.appendChild(box); ta.focus();
}

// zi5i: inline "add to calendar" form. Prefills the subject from the action text,
// guesses a date (d/m) and time (HH:MM) out of it, and you confirm. The Graph
// write fires on "צור אירוע" (zero idle egress).
function calRow(label, node) { const r = mk("div", "tform-row"); r.appendChild(mk("span", "lbl", label)); r.appendChild(node); return r; }
function guessDate(text) {
  const m = (text || "").match(/(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{2,4}))?/);
  if (!m) return "";
  const pad = (n) => String(n).padStart(2, "0");
  const y = m[3] ? (m[3].length === 2 ? "20" + m[3] : m[3]) : String(new Date().getFullYear());
  return `${y}-${pad(m[2])}-${pad(m[1])}`;
}
function guessTime(text) { const m = (text || "").match(/(\d{1,2}):(\d{2})/); return m ? `${String(m[1]).padStart(2, "0")}:${m[2]}` : ""; }
function addHour(hhmm) {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number); const pad = (n) => String(n).padStart(2, "0");
  return `${pad((h + 1) % 24)}:${pad(m)}`;
}
function calBox(row, it) {
  const ex = row.querySelector(".cal-box"); if (ex) { ex.remove(); return; }
  const box = mk("div", "cal-box"); box.style.marginTop = "8px";
  box.appendChild(mk("span", "lbl", "אירוע חדש ביומן"));
  const subj = mk("input"); subj.type = "text"; subj.className = "tag-in"; subj.value = it.text.slice(0, 120);
  box.appendChild(calRow("כותרת", subj));
  const dt = mk("input"); dt.type = "date"; dt.className = "tag-in"; dt.value = guessDate(it.text) || todayISO();
  box.appendChild(calRow("תאריך", dt));
  const st = mk("input"); st.type = "time"; st.className = "tag-in"; st.value = guessTime(it.text) || "09:00";
  const et = mk("input"); et.type = "time"; et.className = "tag-in"; et.value = addHour(st.value) || "10:00";
  st.addEventListener("change", () => { et.value = addHour(st.value) || et.value; });
  const times = mk("div", "cal-times"); times.appendChild(st); times.appendChild(mk("span", "cal-sep", "→")); times.appendChild(et);
  box.appendChild(calRow("שעה", times));
  const loc = mk("input"); loc.type = "text"; loc.className = "tag-in"; loc.placeholder = "מיקום (לא חובה)";
  box.appendChild(calRow("מיקום", loc));
  const rr = mk("div", "rec-row");
  const ok = mk("button", "commit", "צור אירוע"); ok.type = "button"; ok.style.width = "auto";
  ok.addEventListener("click", async () => {
    if (!dt.value) { toast("צריך תאריך"); return; }
    ok.disabled = true; ok.textContent = "יוצר…";
    try {
      await calendarAdd({
        subject: subj.value.trim() || it.text.slice(0, 120),
        startDateTime: `${dt.value}T${st.value || "09:00"}:00`,
        endDateTime: `${dt.value}T${et.value || st.value || "10:00"}:00`,
        location: loc.value.trim(), tz: CONFIG.calendarTz,
        bodyText: it.source ? "מקור: " + it.source : "",
      });
      box.remove();
    } catch (e) {
      ok.disabled = false; ok.textContent = "צור אירוע";
      toast(/403/.test(e.message) ? "צריך להתחבר מחדש לאישור הרשאת יומן" : "יצירת אירוע נכשלה: " + e.message);
    }
  });
  const cancel = mk("button", "iconbtn", "ביטול"); cancel.type = "button"; cancel.addEventListener("click", () => box.remove());
  rr.appendChild(ok); rr.appendChild(cancel); box.appendChild(rr);
  row.appendChild(box);
}

function inlineEdit(row, it, field, label, items, save, rerender) {
  const box = mk("div"); box.style.marginTop = "8px";
  box.appendChild(mk("span", "lbl", label));
  const ta = mk("textarea", "ta-remark"); ta.value = it[field] || "";
  box.appendChild(ta);
  const rr = mk("div", "rec-row"); rr.appendChild(micButton(ta));
  const ok = mk("button", "iconbtn", "שמור"); ok.type = "button";
  ok.addEventListener("click", () => { it[field] = ta.value.trim(); save(items); rerender(); });
  const cancel = mk("button", "iconbtn", "ביטול"); cancel.type = "button";
  cancel.addEventListener("click", () => rerender());
  rr.appendChild(ok); rr.appendChild(cancel); box.appendChild(rr);
  row.appendChild(box); ta.focus();
}

function openAdd(container, items, save, rerender) {
  const box = mk("div", "card");
  box.appendChild(mk("span", "lbl", "משימה חדשה"));
  const ta = mk("textarea", "ta-remark"); ta.placeholder = "מה צריך לעשות?"; box.appendChild(ta);
  const taRow = mk("div", "rec-row"); taRow.appendChild(micButton(ta)); box.appendChild(taRow);
  const ownerWrap = mk("div", "pills"); ownerWrap.style.marginTop = "8px";
  let owner = "machine";
  [["machine", "המכונה תעשה"], ["assaf", "אני אעשה"]].forEach(([v, l]) => {
    const b = mk("button", "pill" + (v === "machine" ? " sel" : ""), l); b.type = "button";
    b.addEventListener("click", () => { owner = v; ownerWrap.querySelectorAll(".pill").forEach((p) => p.classList.remove("sel")); b.classList.add("sel"); });
    ownerWrap.appendChild(b);
  });
  box.appendChild(ownerWrap);
  const rr = mk("div", "rec-row");
  const ok = mk("button", "commit", "הוסף"); ok.type = "button"; ok.style.width = "auto";
  ok.addEventListener("click", () => {
    const t = ta.value.trim(); if (!t) { toast("צריך טקסט"); return; }
    items.unshift({ date: todayISO(), source: "ידני", text: t, owner, status: owner === "assaf" ? "waiting" : "todo", result: "" });
    save(items); rerender();
  });
  rr.appendChild(ok); box.appendChild(rr);
  container.insertBefore(box, container.querySelector("section") || null);
  ta.focus();
}

// ---------- live ----------
export async function loadActions(token, container) {
  container.innerHTML = ""; container.appendChild(mk("p", "muted", "טוען פעולות…"));
  let text;
  try { text = await getDrivePathText(token, CONFIG.actionsPath); }
  catch (e) { container.innerHTML = ""; container.appendChild(mk("p", "err-msg", "שגיאת טעינה: " + e.message)); return; }
  const { head } = splitHead(text || "");
  const items = parseBody(splitHead(text || "").body);

  let saving = false;
  const save = async (model) => {
    if (saving) return; saving = true;
    try { await putDrivePathText(token, CONFIG.actionsPath, serialize(head, model)); }
    catch (e) { toast("שמירה נכשלה: " + e.message); }
    finally { saving = false; }
  };
  calendarAdd = (evt) => createCalendarEvent(token, evt).then(() => toast("נוסף ליומן ✓"));
  container.innerHTML = "";
  makeBoard(container, head, items, save);
}

// ---------- demo (no auth) ----------
const DEMO_HEAD = "# Actions (demo)\n\n" + MARKER;
const DEMO_ITEMS = [
  { date: "2026-06-18", source: "aaaa-demo", text: "(דוגמה) לבדוק מועדים אפשריים ולהציע חלון ביומן", owner: "machine", status: "done", result: "(דוגמה) שלוש אפשרויות נמצאו. ההמלצה מסומנת בראש הרשימה." },
  { date: "2026-06-18", source: "aaaa-demo", text: "(דוגמה) לבחור מועד ולסגור אותו", owner: "assaf", status: "waiting", result: "" },
  { date: "2026-06-18", source: "bbbb-demo", text: "(דוגמה) פנייה לאדם - דורש אותך", owner: "assaf", status: "waiting", result: "" },
  { date: "2026-06-18", source: "cccc-demo", text: "(דוגמה) לרשום פריט במעקב", owner: "machine", status: "todo", result: "(דוגמה) ממתין לאימות נתיב הקובץ." },
];
export function loadActionsDemo(container) {
  container.innerHTML = "";
  calendarAdd = async (evt) => { toast("מצב הדגמה · אירוע לא נכתב (" + evt.subject + ")"); };
  const items = DEMO_ITEMS.map((x) => ({ ...x }));
  const save = () => { /* demo: local only */ };
  makeBoard(container, DEMO_HEAD, items, save);
  container.appendChild(mk("p", "hint", "מצב הדגמה - שינויים מקומיים בלבד, ללא כתיבה ל-OneDrive."));
}

// phoe: number of items still waiting on Assaf (owner:assaf, not done) - the nav badge count.
export function countWaitingActions(text) {
  return parseBody(splitHead(text || "").body).filter((i) => i.owner === "assaf" && i.status !== "done").length;
}

// "המשך מכאן": flat list of items waiting on you (owner:assaf, not done) for the home card.
export function listWaitingActions(text) {
  return parseBody(splitHead(text || "").body)
    .filter((i) => i.owner === "assaf" && i.status !== "done")
    .map((i) => ({ text: i.text, source: i.source, date: i.date }));
}
