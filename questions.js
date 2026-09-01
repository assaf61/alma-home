// Open-questions board - "the machine needs a decision from you", centralized.
// Ports qboard (Alma.R\99-harvest\open-questions.md) into בית עלמא with the same
// rich surface as the threads dispatcher, mobile-first, PLUS full CRUD (Assaf
// asked for max flexibility: add / edit / delete, for Chat/Cowork questions that
// don't auto-collect).
//
// MODEL: the board shows ONLY open questions (the backlog). Answering CLEARS a
// question (logs + archives + optionally distributes to a vault + removes it).
// Done = gone. New open questions arrive via the session-close skills, or you
// add them manually here.
import { getDrivePathText, putDrivePathText } from "./graph.js";
import { CONFIG } from "./config.js";
import { toast, micButton, onTap, startDictation } from "./ui.js";
import { domains } from "./domains.js";

const PRIOS = [["p1", "P1 גבוה"], ["p2", "P2 בינוני"], ["p3", "P3 נמוך"]];
const TIMES = [["now", "עכשיו"], ["soon", "קרוב"], ["later", "מאוחר"], ["someday", "יום אחד"]];
const DOMAINS = ["בנייה", "בריאות", "השקעות", "כספים", "יומיומי", "מחקר", "מסחור", "תודעה", "כללי"];
// Vault merge 02/07: one private vault (Alma.R); old vault slugs live on as domain tags.
// 16/08/2026: שתי הרשימות עברו ל-alma-paths.json מאחורי ההזדהות (domains.js), כי
// שם-הדום החתום היה קריא בקוד ציבורי. הערכים ב-VAULT_DIR אינם תוויות בלבד - הם
// משמשים גם כמקטע-נתיב בכתיבה, ולכן הועברו מילה-במילה.
const VAULT_DIR = () => domains().questions_dirs;
const VAULT_OPTIONS = () => domains().questions_vaults;
const MARKER_Q = "<!-- שאלות פתוחות חדשות - הוסף מתחת לשורה הזו -->";

function mk(tag, cls, txt) { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
function todayISO() { const d = new Date(); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
function stamp() { const d = new Date(); const p = (n) => String(n).padStart(2, "0"); return `${todayISO()} ${p(d.getHours())}:${p(d.getMinutes())}`; }

async function qid(project, text) {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(project + "||" + text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 12);
}

const PROJ_RE = /\[\[([^\]]+)\]\]/;
const DATE_RE = /(\d{4}-\d{2}-\d{2})/;
const RESOLVED_RE = /<!--\s*resolved:[0-9-]+\s*-->/;

function parseHeader(h) {
  const pm = h.match(PROJ_RE);
  const project = pm ? pm[1] : h.split("|")[0].trim();
  const dm = h.match(DATE_RE);
  const date = dm ? dm[1] : "";
  const parts = h.split("|").map((p) => p.trim());
  const platform = parts.length > 1 ? parts[parts.length - 1] : "";
  return { project, date, platform };
}

function parseOpen(text) {
  const lines = (text || "").split("\n");
  const groups = []; const byProj = {};
  let cur = null, inComment = false;
  for (const line of lines) {
    const s = line.trim();
    if (inComment) { if (s.includes("-->")) inComment = false; continue; }
    const hm = line.match(/^##\s+(.*)$/);
    if (hm) {
      const { project, date, platform } = parseHeader(hm[1]);
      if (!byProj[project]) { byProj[project] = { project, date, platform, questions: [] }; groups.push(byProj[project]); }
      cur = byProj[project]; continue;
    }
    if (s.startsWith("<!--")) { if (!s.includes("-->")) inComment = true; continue; }
    if (/^\s+- \*\*תשובה:\*\*/.test(line)) continue;
    const qm = line.match(/^- (.*)$/) || line.match(/^\d+\.\s+(.*)$/);
    if (qm && cur) {
      const full = qm[1].trim();
      if (RESOLVED_RE.test(full)) continue;
      cur.questions.push({ project: cur.project, date: cur.date, platform: cur.platform, text: full });
    }
  }
  return groups.filter((g) => g.questions.length);
}

function removeQuestion(text, project, qtext) {
  const lines = text.split("\n");
  const out = []; let cur = null, done = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const hm = line.match(/^##\s+(.*)$/);
    if (hm) { cur = parseHeader(hm[1]).project; out.push(line); continue; }
    const qm = line.match(/^- (.*)$/) || line.match(/^\d+\.\s+(.*)$/);
    if (qm && cur === project && !done) {
      const base = qm[1].replace(RESOLVED_RE, "").trim();
      if (base === qtext) {
        done = true;
        if (/^\s+- \*\*תשובה:\*\*/.test(lines[i + 1] || "")) i++;
        continue;
      }
    }
    out.push(line);
  }
  return out.join("\n");
}

function editQuestionLine(text, project, oldText, newText) {
  const lines = text.split("\n"); let cur = null, done = false;
  return lines.map((line) => {
    const hm = line.match(/^##\s+(.*)$/);
    if (hm) { cur = parseHeader(hm[1]).project; return line; }
    const qm = line.match(/^- (.*)$/) || line.match(/^\d+\.\s+(.*)$/);
    if (qm && cur === project && !done) {
      const base = qm[1].replace(RESOLVED_RE, "").trim();
      if (base === oldText) { done = true; return "- " + newText; }
    }
    return line;
  }).join("\n");
}

function addQuestionBlock(text, qtext, source) {
  const block = `\n## ${todayISO()} | [[${source || "ידני"}]] | manual\n- ${qtext}\n`;
  const i = text.indexOf(MARKER_Q);
  if (i < 0) return text.replace(/\s*$/, "") + "\n" + MARKER_Q + block;
  const at = i + MARKER_Q.length;
  return text.slice(0, at) + block + text.slice(at);
}

function pillGroup(opts, selected) {
  const wrap = mk("div", "pills");
  opts.forEach(([v, label]) => {
    const b = mk("button", "pill" + (v === selected ? " sel" : ""), label); b.type = "button"; b.dataset.v = v;
    b.addEventListener("click", () => {
      const was = b.classList.contains("sel");
      wrap.querySelectorAll(".pill").forEach((p) => p.classList.remove("sel"));
      if (!was) b.classList.add("sel");
    });
    wrap.appendChild(b);
  });
  return wrap;
}
function selectedPill(w) { const s = w.querySelector(".pill.sel"); return s ? s.dataset.v : ""; }
function fieldRow(label, node) { const r = mk("div", "tform-row"); r.appendChild(mk("span", "lbl", label)); r.appendChild(node); return r; }

let speaking = false;
function speak(txt) {
  if (!("speechSynthesis" in window)) { toast("הדפדפן לא תומך בהקראה"); return; }
  if (speaking) { speechSynthesis.cancel(); speaking = false; return; }
  const u = new SpeechSynthesisUtterance(txt); u.lang = "he-IL";
  const v = speechSynthesis.getVoices().find((x) => x.lang && x.lang.startsWith("he")); if (v) u.voice = v;
  u.onend = () => { speaking = false; };
  speaking = true; speechSynthesis.speak(u);
}
// mic-v2 (23/07): הלוגיקה המרכזית ב-ui.js (התנעה-מחדש אוטומטית, ביניים, שמירת-נקלט).
let dict = null;
function toggleDictate(ta, btn) {
  if (dict) { dict.stop(); dict = null; return; }
  dict = startDictation(ta, (on) => {
    if (on) { btn.classList.add("on"); btn.textContent = "⏹ עצור"; }
    else { dict = null; btn.classList.remove("on"); btn.textContent = "🎤 הכתב תשובה"; }
  });
}

function header(container, openN) {
  const h = mk("div", "thr-head");
  h.appendChild(mk("span", "over", "שאלות פתוחות"));
  h.appendChild(mk("span", "thr-count", `${openN} ממתינות להחלטה`));
  container.appendChild(h);
}

function renderQ(q, h) {
  const row = mk("div", "thr"); row.id = "q-" + (q._k);
  const head = mk("button", "thr-head-row"); head.type = "button";
  if (q.platform) head.appendChild(mk("span", "kind", q.platform));
  if (q.date) head.appendChild(mk("span", "time ltr", q.date));
  head.appendChild(mk("span", "sum", q.text));
  const chev = mk("span", "chev", "▾"); head.appendChild(chev);
  row.appendChild(head);

  const form = mk("div", "thr-form");
  const tts = mk("button", "iconbtn", "🔊 הקרא לי"); tts.type = "button";
  tts.addEventListener("click", () => speak(q.text));
  const ttsWrap = mk("div", "thr-text"); ttsWrap.appendChild(tts);
  if (q.project) ttsWrap.appendChild(mk("div", "thr-body", "מקור: " + q.project));
  form.appendChild(ttsWrap);

  const ta = mk("textarea", "ta-remark"); ta.placeholder = "התשובה / ההחלטה שלך...";
  const dictate = mk("button", "iconbtn", "🎤 הכתב תשובה"); dictate.type = "button";
  dictate.addEventListener("click", () => toggleDictate(ta, dictate));
  const ansWrap = mk("div"); ansWrap.appendChild(ta);
  const recRow = mk("div", "rec-row"); recRow.appendChild(dictate); ansWrap.appendChild(recRow);
  form.appendChild(fieldRow("התשובה", ansWrap));

  const gPrio = pillGroup(PRIOS, ""); form.appendChild(fieldRow("עדיפות", gPrio));
  const gTime = pillGroup(TIMES, ""); form.appendChild(fieldRow("מתי", gTime));

  const tagIn = mk("input"); tagIn.type = "text"; tagIn.className = "tag-in"; tagIn.placeholder = "תגית דומיין...";
  const tagPills = mk("div", "pills");
  DOMAINS.forEach((d) => { const b = mk("button", "pill mini", d); b.type = "button"; b.addEventListener("click", () => { tagIn.value = d; }); tagPills.appendChild(b); });
  const tagWrap = mk("div"); tagWrap.appendChild(tagIn); tagWrap.appendChild(tagPills);
  form.appendChild(fieldRow("תגית", tagWrap));

  const sel = mk("select");
  VAULT_OPTIONS().forEach(([slug, label]) => { const o = mk("option", null, label); o.value = slug; sel.appendChild(o); });
  form.appendChild(fieldRow("ניתוב ההחלטה (הפצה)", sel));

  const btn = mk("button", "commit", "✓ ענה והפץ"); btn.type = "button";
  btn.addEventListener("click", () => h.onAnswer(q, {
    answer: ta.value, priority: selectedPill(gPrio), timing: selectedPill(gTime),
    tag: tagIn.value.trim(), vault: sel.value,
  }, row, btn));
  form.appendChild(btn);

  // manage row: edit / delete (max flexibility)
  const manage = mk("div", "rec-row"); manage.style.marginTop = "10px";
  const editB = mk("button", "iconbtn", "✎ ערוך שאלה"); editB.type = "button";
  editB.addEventListener("click", () => h.onEdit(q, form));
  const delB = mk("button", "iconbtn", "🗑 מחק"); delB.type = "button";
  delB.addEventListener("click", () => h.onDelete(q, row));
  manage.appendChild(editB); manage.appendChild(delB);
  form.appendChild(manage);

  onTap(head, () => { const open = form.classList.toggle("open"); chev.textContent = open ? "▴" : "▾"; });
  row.appendChild(form);
  return row;
}

function markCleared(row, vault) {
  row.classList.add("locked", "just-locked");
  const form = row.querySelector(".thr-form"); if (form) form.remove();
  const chev = row.querySelector(".chev"); if (chev) chev.remove();
  row.appendChild(mk("span", "locked-tag", vault ? "נענה · נותב → " + (VAULT_DIR()[vault] || vault) : "נענה · נוקה"));
  const list = row.closest(".thr-list"); const cnt = list && list.parentElement.querySelector(".thr-count");
  if (cnt) { const open = list.querySelectorAll(".thr:not(.locked)").length; cnt.textContent = `${open} ממתינות להחלטה`; }
}

function inlineEditQ(form, q, onSave) {
  const box = mk("div"); box.style.marginTop = "8px";
  box.appendChild(mk("span", "lbl", "עריכת נוסח השאלה"));
  const ta = mk("textarea", "ta-remark"); ta.value = q.text; box.appendChild(ta);
  const rr = mk("div", "rec-row"); rr.appendChild(micButton(ta));
  const ok = mk("button", "iconbtn", "שמור"); ok.type = "button";
  ok.addEventListener("click", () => { const nt = ta.value.trim(); if (nt) onSave(nt); });
  const cancel = mk("button", "iconbtn", "ביטול"); cancel.type = "button"; cancel.addEventListener("click", () => box.remove());
  rr.appendChild(ok); rr.appendChild(cancel); box.appendChild(rr);
  form.classList.add("open"); form.appendChild(box); ta.focus();
}

function addForm(container, onAdd) {
  const box = mk("div", "card");
  box.appendChild(mk("span", "lbl", "שאלה חדשה (ידנית)"));
  const ta = mk("textarea", "ta-remark"); ta.placeholder = "מה השאלה / ההחלטה שצריך?"; box.appendChild(ta);
  const taRow = mk("div", "rec-row"); taRow.appendChild(micButton(ta)); box.appendChild(taRow);
  const srcIn = mk("input"); srcIn.type = "text"; srcIn.className = "tag-in"; srcIn.placeholder = "מקור (לא חובה): chat / cowork / נושא"; srcIn.style.marginTop = "8px"; box.appendChild(srcIn);
  const rr = mk("div", "rec-row");
  const ok = mk("button", "commit", "הוסף"); ok.type = "button"; ok.style.width = "auto";
  ok.addEventListener("click", () => { const t = ta.value.trim(); if (!t) { toast("צריך טקסט"); return; } onAdd(t, srcIn.value.trim()); });
  const cancel = mk("button", "iconbtn", "ביטול"); cancel.type = "button"; cancel.addEventListener("click", () => box.remove());
  rr.appendChild(ok); rr.appendChild(cancel); box.appendChild(rr);
  container.insertBefore(box, container.querySelector(".thr-list") || null);
  ta.focus();
}

// ---------- live ----------
export async function loadQuestions(token, container) {
  container.innerHTML = ""; container.appendChild(mk("p", "muted", "טוען שאלות…"));
  let text;
  try { text = await getDrivePathText(token, CONFIG.openQuestionsPath); }
  catch (e) { container.innerHTML = ""; container.appendChild(mk("p", "err-msg", "שגיאת טעינה: " + e.message)); return; }

  // חסינות-404 (הכרעת אסף 25/08/2026). getDrivePathText מחזיר null כשגרף מחזיר 404,
  // וה-null זרם ל-parseOpen("") - כלומר קובץ חסר נראה על המסך בדיוק כמו לוח ריק.
  // שני מצבים שונים לגמרי, אותה תצוגה. עכשיו נופלים לארכיון, ואם גם הוא איננו,
  // אומרים את זה במילים במקום להעמיד פנים שהכל תקין.
  if (text === null) {
    let fallback = null;
    try { fallback = await getDrivePathText(token, CONFIG.openQuestionsArchivePath); }
    catch { /* גם הארכיון אינו נגיש - ההודעה שלמטה מטפלת */ }
    if (fallback === null) {
      container.innerHTML = "";
      container.appendChild(mk("p", "err-msg", "קובץ השאלות לא נמצא"));
      container.appendChild(mk("p", "muted", "הלוח אינו ריק - הקובץ עצמו איננו בנתיב שלו, וגם לא בארכיון. אם הועבר, יש לעדכן את הנתיב בהגדרות."));
      return;
    }
    container.appendChild(mk("p", "muted", "הקובץ הראשי לא נמצא - מוצג הארכיון."));
    text = fallback;
  }

  const groups = parseOpen(text || "");
  const all = []; groups.forEach((g) => g.questions.forEach((q) => { q._k = Math.random().toString(36).slice(2, 8); all.push(q); }));

  const refresh = () => loadQuestions(token, container);
  const h = {
    onAnswer: (qq, opts, row, btn) => doAnswer(token, qq, opts, row, btn),
    onEdit: (qq, form) => inlineEditQ(form, qq, async (nt) => {
      try { const t = await getDrivePathText(token, CONFIG.openQuestionsPath); await putDrivePathText(token, CONFIG.openQuestionsPath, editQuestionLine(t, qq.project, qq.text, nt)); toast("עודכן"); refresh(); }
      catch (e) { toast("עדכון נכשל: " + e.message); }
    }),
    onDelete: async (qq) => {
      if (!confirm("למחוק את השאלה מהבקלוג?")) return;
      try { const t = await getDrivePathText(token, CONFIG.openQuestionsPath); await putDrivePathText(token, CONFIG.openQuestionsPath, removeQuestion(t || "", qq.project, qq.text)); toast("נמחקה"); refresh(); }
      catch (e) { toast("מחיקה נכשלה: " + e.message); }
    },
  };

  container.innerHTML = "";
  header(container, all.length);
  const addBtn = mk("button", "btn-ghost", "+ שאלה"); addBtn.style.marginBottom = "6px";
  addBtn.addEventListener("click", () => addForm(container, async (t, src) => {
    try { const cur = (await getDrivePathText(token, CONFIG.openQuestionsPath)) || ""; await putDrivePathText(token, CONFIG.openQuestionsPath, addQuestionBlock(cur, t, src)); toast("נוספה"); refresh(); }
    catch (e) { toast("הוספה נכשלה: " + e.message); }
  }));
  container.appendChild(addBtn);

  if (!all.length) {
    container.appendChild(mk("div", "card empty", "אין שאלות פתוחות. הכול נסגר. ✓"));
    container.appendChild(mk("p", "hint", "שאלות חדשות נכנסות אוטומטית בסגירת סשן (בוקר טוב / לילה טוב / ביי), או הוסף ידנית למעלה."));
    return;
  }
  const list = mk("div", "thr-list");
  all.forEach((q) => list.appendChild(renderQ(q, h)));
  container.appendChild(list);
  container.appendChild(mk("p", "hint", "מענה = ‘החלטתי, בצע’. השאלה תיווסף ללוג + לארכיון, תנותב לוולט, ותיעלם מהבקלוג. ערוך/מחק/הוסף בכל עת."));
}

// 16/08 (הדלפק היחיד): הליבה נטולת-DOM. counter.js עונה על שאלת-לוח דרך אותו
// נתיב מוכח (log, ארכיון, הסרה מהפתוחות) במקום לשכפל אותו. לקח 25/07: לפני
// שכותבים מימוש חדש, לחפש אם קיים כבר פתרון מוכח במקום אחר במכונה.
export async function answerQuestionCore(token, q, answer, opts) {
  const o = opts || {};
  const id = await qid(q.project, q.text);
  const date = todayISO();
  const logLine = JSON.stringify({ id, answer, date, priority: o.priority, timing: o.timing, tag: o.tag, vault: o.vault, project: q.project, text: q.text }) + "\n";
  const curLog = (await getDrivePathText(token, CONFIG.resolvedLogPath)) || "";
  await putDrivePathText(token, CONFIG.resolvedLogPath, curLog + logLine);

  const archBlock = `\n## ${q.date || date} | [[${q.project}]] | ${q.platform || ""}\n- ${q.text}  <!-- resolved:${date} -->\n  - **תשובה:** ${answer}\n`;
  const curArch = (await getDrivePathText(token, CONFIG.openQuestionsArchivePath)) || "";
  await putDrivePathText(token, CONFIG.openQuestionsArchivePath, curArch.replace(/\s*$/, "\n") + archBlock);

  const curOpen = (await getDrivePathText(token, CONFIG.openQuestionsPath)) || "";
  await putDrivePathText(token, CONFIG.openQuestionsPath, removeQuestion(curOpen, q.project, q.text));

  let routeError = null;
  if (o.vault && VAULT_DIR()[o.vault]) {
    try {
      const meta = ["---", "type: answered-question", `project: ${q.project}`, `answered: ${stamp()}`,
        o.priority ? `priority: ${o.priority}` : "", o.timing ? `timing: ${o.timing}` : "",
        o.tag ? `domain_tag: ${o.tag}` : "", "---"].filter(Boolean).join("\n");
      const body = `\n## שאלה\n${q.text}\n\n## תשובה\n${answer}\n`;
      const path = `Alma Mind/${VAULT_DIR()[o.vault]}/00-raw/threads/q-${id}-${date}.md`;
      await putDrivePathText(token, path, meta + body);
    } catch (e) { routeError = e.message; }
  }
  return { id, routeError };
}

async function doAnswer(token, q, opts, row, btn) {
  const answer = (opts.answer || "").trim();
  if (!answer) { toast("צריך תשובה"); return; }
  btn.disabled = true; btn.textContent = "שומר…";
  try {
    const { routeError } = await answerQuestionCore(token, q, answer, opts);
    if (routeError) toast("נשמר, אך הניתוב לוולט נכשל: " + routeError);
    markCleared(row, opts.vault);
    toast(opts.vault ? "נענה · נותב אל " + (VAULT_DIR()[opts.vault] || opts.vault) : "נענה · נוקה מהבקלוג");
  } catch (e) {
    btn.disabled = false; btn.textContent = "✓ ענה והפץ";
    toast("שמירה נכשלה: " + e.message);
  }
}

// ---------- demo (no auth) ----------
let DEMO = [
  { _k: "d1", project: "bait-alma", date: "2026-06-18", platform: "claude-code", text: "מה תזת המאסטר-קלאס במשפט אחד?" },
  { _k: "d2", project: "demo-consult", date: "2026-06-18", platform: "chat", text: "להפיק מכתב סיכום אחרי פגישת הייעוץ? (דוגמה)" },
];
export function loadQuestionsDemo(container) {
  const refresh = () => loadQuestionsDemo(container);
  const h = {
    onAnswer: (qq, opts, row) => { if (!(opts.answer || "").trim()) { toast("צריך תשובה"); return; } markCleared(row, opts.vault); toast("מצב הדגמה · נענה (לא נכתב ל-OneDrive)"); },
    onEdit: (qq, form) => inlineEditQ(form, qq, (nt) => { qq.text = nt; toast("מצב הדגמה · עודכן"); refresh(); }),
    onDelete: (qq) => { DEMO = DEMO.filter((x) => x._k !== qq._k); toast("מצב הדגמה · נמחקה"); refresh(); },
  };
  container.innerHTML = "";
  header(container, DEMO.length);
  const addBtn = mk("button", "btn-ghost", "+ שאלה"); addBtn.style.marginBottom = "6px";
  addBtn.addEventListener("click", () => addForm(container, (t, src) => { DEMO.unshift({ _k: Math.random().toString(36).slice(2, 8), project: src || "ידני", date: todayISO(), platform: "manual", text: t }); toast("מצב הדגמה · נוספה"); refresh(); }));
  container.appendChild(addBtn);
  const list = mk("div", "thr-list");
  DEMO.forEach((q) => list.appendChild(renderQ(q, h)));
  container.appendChild(list);
  container.appendChild(mk("p", "hint", "מצב הדגמה - שינויים מקומיים בלבד, ללא כתיבה ל-OneDrive."));
}

// phoe: number of open questions in the backlog - the nav badge count.
export function countOpenQuestions(text) {
  return parseOpen(text || "").reduce((n, g) => n + g.questions.length, 0);
}

// "המשך מכאן": flat list of open questions for the unified home card.
export function listOpenQuestions(text) {
  const out = [];
  parseOpen(text || "").forEach((g) => g.questions.forEach((q) => out.push({ text: q.text, source: q.project, date: q.date })));
  return out;
}
