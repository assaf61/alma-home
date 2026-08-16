// Live threads dispatcher - the heart of בית עלמא.
// Reads the inbox live via Graph and gives each thread the FULL triage surface
// (the same fields as threads-triage.html): bucket, vault, domain tag, priority,
// timing, a free-text remark, voice dictation into the remark, and read-aloud.
// "✓ נעל ותייק" commits every field at once: structured values go into the
// frontmatter, the prose remark goes into the body under "## הערת מיון", and a
// scheduled `distribute.py --locked-only` files the whole thing (frontmatter +
// body travel with the file - verified in distribute.py) into the chosen vault.
//
// The frontmatter mutation MIRRORS worker/lock.py so a manual run files it
// identically:
//     locked: true
//     locked_vault: <slug>
//     locked_at: YYYY-MM-DD HH:MM
//     triage_bucket / priority / timing / domain_tag   (only when set)
import { listInbox, getFileText, putDrivePathText } from "./graph.js";
import { CONFIG } from "./config.js";
import { toast, onTap, startDictation } from "./ui.js";
import { domains } from "./domains.js";

// Three-dome model (Assaf 24/06: "moving from nine vaults to three"). The old
// 9 per-domain vaults collapse into ONE private working dome (Alma.R); the domain
// (health/invest/...) lives on as the domain_tag below, not as a separate vault.
//   - עלמא · פרטי   = Alma.R, the dome where Assaf works (default, everything connected)
//   - the sealed dome = never leaves; its name is not written here (see domains.js)
//   - הדום הציבורי   = future/working dome - not connecting with anyone yet, so it is a
//                      placeholder; a thread sent here still lives in Alma.R for now but is
//                      STAMPED filed_vault: alma-public so the public set is findable when
//                      that dome is actually built (distribute.py maps alma-public -> Alma.R).
//   - השאר ב-inbox  = don't file
// 16/08/2026: נטענת מ-alma-paths.json אחרי הזדהות (domains.js), לא מקודדת כאן.
const VAULT_OPTIONS = () => domains().threads_vaults;
// What will be done with the thread (mirrors triage BUCKETS).
const BUCKETS = [
  ["promote", "קידום לוולט"], ["action", "פעולה מיידית"], ["research", "מחקר עומק"],
  ["collector", "שדרוג הלוכד"], ["brief", "לבריף"], ["archive", "ארכיון"],
];
const PRIOS = [["p1", "P1 גבוה"], ["p2", "P2 בינוני"], ["p3", "P3 נמוך"]];
const TIMES = [["now", "עכשיו"], ["soon", "קרוב"], ["later", "מאוחר"], ["someday", "יום אחד"]];
const DOMAINS = ["בנייה", "בריאות", "השקעות", "כספים", "יומיומי", "מחקר", "מסחור", "תודעה", "כללי"];
const KIND_HE = { voice: "קול", photo: "תמונה", text: "טקסט", link: "לינק" };
const REMARK_HEAD = "## הערת מיון";

// ---- frontmatter helpers (mirror lock.py parse_note / fm_set / write_atomic) ----
function parseNote(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { fm: null, body: text };
  return { fm: m[1].split(/\r?\n/), body: text.slice(m[0].length) };
}
function fmGet(fm, key) {
  if (!fm) return null;
  for (const l of fm) if (l.startsWith(key + ":")) return l.slice(l.indexOf(":") + 1).trim();
  return null;
}
function fmSet(fm, key, val) {
  for (let i = 0; i < fm.length; i++) if (fm[i].startsWith(key + ":")) { fm[i] = key + ": " + val; return; }
  fm.push(key + ": " + val);
}
function buildNote(fm, body) {
  let out = "---\n" + fm.join("\n") + "\n---\n" + body;
  if (!out.endsWith("\n")) out += "\n";
  return out;
}
// Add/replace a "## הערת מיון" section in the body (idempotent), so re-locking
// updates the remark instead of stacking duplicates. The section runs until the
// next "## " heading or end of file.
function setRemark(body, remark) {
  const text = (remark || "").trim();
  let base = body.replace(/\n*## הערת מיון\r?\n[\s\S]*?(?=\r?\n## |$)/, "\n")
    .replace(/\n{3,}/g, "\n\n").replace(/\s*$/, "");
  if (!text) return base ? base + "\n" : "";
  return (base ? base + "\n\n" : "") + REMARK_HEAD + "\n" + text + "\n";
}
function threadId(name) {
  const m = name.match(/-([a-z0-9]{3,6})\.md$/);
  return m ? m[1] : name.replace(/\.md$/, "");
}
function nowStamp() {
  const d = new Date(); const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function shortTime(iso) {
  if (!iso) return "";
  try { const d = new Date(iso); const p = (n) => String(n).padStart(2, "0"); return `${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`; }
  catch { return ""; }
}
function extractSummary(body) {
  const stripped = (body || "").replace(/\n*## הערת מיון\r?\n[\s\S]*?(?=\r?\n## |\s*$)/, "");
  const m = stripped.match(/##\s*תקציר\s*\r?\n([\s\S]*?)(?:\r?\n##|\s*$)/);
  if (m) { const line = m[1].trim().split(/\r?\n/)[0]; if (line) return line; }
  for (const l of stripped.split(/\r?\n/)) { const t = l.trim(); if (t && !t.startsWith("#")) return t; }
  return "(ללא תקציר)";
}

function mk(tag, cls, txt) { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }

function isSkippable(name) {
  const n = name.toLowerCase();
  return n === "commercial-threads.md" || n.includes("conflict") || /-[a-z0-9-]*desktop[a-z0-9-]*\.md$/.test(n);
}

// Build a view-model row from an inbox item + its parsed file.
function toView(item, text) {
  const { fm, body } = parseNote(text);
  const get = (k) => (fm ? fmGet(fm, k) : null);
  return {
    name: item.name,
    id: threadId(item.name),
    kind: KIND_HE[get("capture_kind")] || get("capture_kind") || "פריט",
    time: shortTime(item.lastModifiedDateTime),
    sug: get("suggested_vault") || "alma-threads",
    sensitive: get("sensitive") === "true",
    summary: extractSummary(body || ""),
    tags: (get("suggested_tags") || "").replace(/^\[|\]$/g, "").split(",").map((s) => s.trim()).filter(Boolean),
    full: (body || "").replace(/\n*## הערת מיון\r?\n[\s\S]*$/, "").trim(),
    locked: get("locked") === "true",
    lockedVault: get("locked_vault"),
  };
}

function vaultLabel(slug) { const f = VAULT_OPTIONS().find(([v]) => v === slug); return f ? f[1] : slug; }

// ---- a single-select pill group; returns the element, read via selectedPill() ----
function pillGroup(opts, selected) {
  const wrap = mk("div", "pills");
  opts.forEach(([v, label]) => {
    const b = mk("button", "pill" + (v === selected ? " sel" : ""), label);
    b.type = "button"; b.dataset.v = v;
    b.addEventListener("click", () => {
      const was = b.classList.contains("sel");
      wrap.querySelectorAll(".pill").forEach((p) => p.classList.remove("sel"));
      if (!was) b.classList.add("sel"); // tap again to clear
    });
    wrap.appendChild(b);
  });
  return wrap;
}
function selectedPill(wrap) { const s = wrap.querySelector(".pill.sel"); return s ? s.dataset.v : ""; }

function fieldRow(labelText, node) {
  const r = mk("div", "tform-row");
  r.appendChild(mk("span", "lbl", labelText));
  r.appendChild(node);
  return r;
}

function renderRow(v, onLock) {
  const row = mk("div", "thr"); row.id = "thr-" + v.id;

  // ---- compact header (tap to open the form) ----
  const head = mk("button", "thr-head-row"); head.type = "button";
  head.appendChild(mk("span", "kind", v.kind));
  if (v.time) head.appendChild(mk("span", "time ltr", v.time));
  if (v.sensitive) head.appendChild(mk("span", "sens", "רגיש"));
  head.appendChild(mk("span", "sum", v.summary));
  const chev = mk("span", "chev", "▾");
  head.appendChild(chev);
  row.appendChild(head);

  if (v.locked) {
    row.classList.add("locked");
    row.appendChild(mk("span", "locked-tag", "נעול → " + vaultLabel(v.lockedVault)));
    return row;
  }

  // ---- full triage form (hidden until opened) ----
  const form = mk("div", "thr-form");

  // thread text + read-aloud
  const textCard = mk("div", "thr-text");
  const tts = mk("button", "iconbtn", "🔊 הקרא לי"); tts.type = "button";
  tts.addEventListener("click", () => speak(v.summary + ". " + v.full));
  textCard.appendChild(tts);
  if (v.full) textCard.appendChild(mk("div", "thr-body", v.full));
  if (v.tags.length) { const c = mk("div", "chips"); v.tags.forEach((t) => c.appendChild(mk("span", "chip", t))); textCard.appendChild(c); }
  form.appendChild(textCard);

  // bucket
  const gBucket = pillGroup(BUCKETS, "");
  form.appendChild(fieldRow("סל יעד · מה ייעשה", gBucket));

  // vault (9 real folders -> select; pre-selects the machine's suggestion)
  const sel = mk("select");
  VAULT_OPTIONS().forEach(([slug, label]) => { const o = mk("option", null, label); o.value = slug; if (slug === v.sug) o.selected = true; sel.appendChild(o); });
  form.appendChild(fieldRow("לאן שייך · וולט", sel));

  // domain tag (free text + quick pills)
  const tagIn = mk("input"); tagIn.type = "text"; tagIn.className = "tag-in"; tagIn.placeholder = "תגית דומיין: מחקר / בנייה / בריאות...";
  const tagPills = mk("div", "pills");
  DOMAINS.forEach((d) => { const b = mk("button", "pill mini", d); b.type = "button"; b.addEventListener("click", () => { tagIn.value = d; }); tagPills.appendChild(b); });
  const tagWrap = mk("div"); tagWrap.appendChild(tagIn); tagWrap.appendChild(tagPills);
  form.appendChild(fieldRow("תגית דומיין", tagWrap));

  // priority + timing
  const gPrio = pillGroup(PRIOS, "");
  form.appendChild(fieldRow("עדיפות", gPrio));
  const gTime = pillGroup(TIMES, "");
  form.appendChild(fieldRow("מתי", gTime));

  // remark (text) + dictate
  const ta = mk("textarea", "ta-remark"); ta.placeholder = "הערה / החלטה / ניסוח לסשן הבא...";
  const dictate = mk("button", "iconbtn", "🎤 הכתב הערה"); dictate.type = "button";
  dictate.addEventListener("click", () => toggleDictate(ta, dictate));
  const remarkWrap = mk("div");
  remarkWrap.appendChild(ta);
  const recRow = mk("div", "rec-row"); recRow.appendChild(dictate);
  remarkWrap.appendChild(recRow);
  form.appendChild(fieldRow("ההערה שלך", remarkWrap));

  // commit
  const btn = mk("button", "commit", "✓ נעל ותייק"); btn.type = "button";
  btn.addEventListener("click", () => onLock(v, {
    vault: sel.value,
    bucket: selectedPill(gBucket),
    priority: selectedPill(gPrio),
    timing: selectedPill(gTime),
    tag: tagIn.value.trim(),
    remark: ta.value,
  }, row, btn));
  form.appendChild(btn);

  onTap(head, () => {
    const open = form.classList.toggle("open");
    chev.textContent = open ? "▴" : "▾";
  });

  row.appendChild(form);
  return row;
}

function markLocked(row, vault) {
  row.classList.add("locked", "just-locked");
  const form = row.querySelector(".thr-form"); if (form) form.remove();
  const chev = row.querySelector(".chev"); if (chev) chev.remove();
  row.appendChild(mk("span", "locked-tag", "נעול → " + vaultLabel(vault)));
  refreshCount(row);
}

// Recompute the "X ממתינים · Y סה"כ" header from the live DOM after a lock.
function refreshCount(row) {
  const list = row.closest(".thr-list"); if (!list) return;
  const total = list.querySelectorAll(".thr").length;
  const pending = list.querySelectorAll(".thr:not(.locked)").length;
  const el = list.parentElement && list.parentElement.querySelector(".thr-count");
  if (el) el.textContent = `${pending} ממתינים · ${total} סה"כ`;
}

function header(container, total, pending) {
  const h = mk("div", "thr-head");
  h.appendChild(mk("span", "over", "חוטי הנול")); // 12/08 (הכרעת 20/07 שלא הושלמה): מפיץ -> נול, לשם אחיד עם engine.js
  h.appendChild(mk("span", "thr-count", `${pending} ממתינים · ${total} סה"כ`));
  container.appendChild(h);
}

// ---------- live ----------
export async function loadThreads(token, container) {
  container.innerHTML = "";
  container.appendChild(mk("p", "muted", "טוען חוטים…"));
  let items;
  try { items = await listInbox(token, 50); }
  catch (e) { container.innerHTML = ""; container.appendChild(mk("p", "err-msg", "שגיאת טעינה: " + e.message)); return; }

  const files = items.filter((it) => it.file && it.name.toLowerCase().endsWith(".md") && !isSkippable(it.name));
  const views = [];
  for (const it of files) {
    try { views.push(toView(it, await getFileText(token, it.name))); }
    catch { /* skip unreadable file */ }
  }

  container.innerHTML = "";
  const pending = views.filter((v) => !v.locked).length;
  header(container, views.length, pending);

  if (!views.length) { container.appendChild(mk("div", "card empty", "ה-inbox נקי. אין חוטים למיון.")); return; }

  // unlocked first, then locked
  views.sort((a, b) => (a.locked === b.locked ? 0 : a.locked ? 1 : -1));
  const list = mk("div", "thr-list");
  views.forEach((v) => list.appendChild(renderRow(v, (vv, opts, row, btn) => doLock(token, vv, opts, row, btn))));
  container.appendChild(list);
  container.appendChild(mk("p", "hint", "נעילה = ‘החלטתי, בצע, אל תראה לי שוב’. כל מה שמילאת נשמר עם החוט ומתויק אוטומטית בסבב ההפצה (כל 10 דק’)."));
}

// Single-writer: the lock no longer edits the capture file (that was the second
// writer that forked it under OneDrive). It drops a unique op file into _ops/, and
// the worker - the SOLE mutator - applies it on its next cycle. A new uniquely-named
// file never forks, so locking can no longer corrupt a thread.
async function doLock(token, v, opts, row, btn) {
  btn.disabled = true; btn.textContent = "נועל…";
  try {
    const op = {
      op: "lock",
      thread: v.name,
      id: v.id,
      vault: opts.vault,
      bucket: opts.bucket || "",
      priority: opts.priority || "",
      timing: opts.timing || "",
      tag: (opts.tag || "").replace(/[\r\n]+/g, " "),
      remark: opts.remark || "",
      at: nowStamp(),
    };
    const rand = Math.random().toString(36).slice(2, 8);
    const stamp = nowStamp().replace(/[^0-9]/g, "");
    const opPath = `${CONFIG.inboxPath}/_ops/op-${stamp}-${v.id}-${rand}.json`;
    await putDrivePathText(token, opPath, JSON.stringify(op, null, 2));
    markLocked(row, opts.vault);
    toast("נעול → " + vaultLabel(opts.vault) + " · יתויק בסבב הבא");
  } catch (e) {
    btn.disabled = false; btn.textContent = "✓ נעל ותייק";
    toast("נעילה נכשלה: " + e.message);
  }
}

// ---------- read-aloud (TTS) - matches Assaf's "הקרא לי" preference ----------
let speaking = false;
function speak(txt) {
  if (!("speechSynthesis" in window)) { toast("הדפדפן לא תומך בהקראה"); return; }
  if (speaking) { speechSynthesis.cancel(); speaking = false; return; }
  const u = new SpeechSynthesisUtterance(txt); u.lang = "he-IL"; u.rate = 1;
  const v = speechSynthesis.getVoices().find((x) => x.lang && x.lang.startsWith("he")); if (v) u.voice = v;
  u.onend = () => { speaking = false; };
  speaking = true; speechSynthesis.speak(u);
}

// ---------- dictate into the remark (Hebrew speech-to-text) ----------
// Keeps the decision durable as TEXT in the file (no orphaned audio binary),
// matching Assaf's existing Hebrew voice-typing workflow.
// mic-v2 (23/07): הלוגיקה המרכזית ב-ui.js (התנעה-מחדש אוטומטית, ביניים, שמירת-נקלט).
let dict = null;
function toggleDictate(ta, btn) {
  if (dict) { dict.stop(); dict = null; return; }
  dict = startDictation(ta, (on) => {
    if (on) { btn.classList.add("on"); btn.textContent = "⏹ עצור הכתבה"; }
    else { dict = null; btn.classList.remove("on"); btn.textContent = "🎤 הכתב הערה"; }
  });
}

// ---------- demo (local dev, no auth) ----------
const DEMO = [
  { name: "demo-aa11.md", id: "aa11", kind: "קול", time: "18.06 09:14", sug: "alma-research", sensitive: false, summary: "רעיון לבדיקה: מסגרת חוצת-תחומים לשיטה כמוצר.", tags: ["method", "product"], full: "תמליל הדגמה. תוכן סינתטי בלבד.", locked: false },
  { name: "demo-bb22.md", id: "bb22", kind: "תמונה", time: "18.06 10:02", sug: "alma-r", sensitive: false, summary: "צילום מודעה - אירוע תרבות בשבוע הבא.", tags: ["event"], full: "ניתוח הדגמה. תוכן סינתטי בלבד.", locked: false },
  { name: "demo-cc33.md", id: "cc33", kind: "טקסט", time: "18.06 11:20", sug: "alma-daily", sensitive: false, summary: "תזכורת קצרה לסידור בבית.", tags: [], full: "טקסט הדגמה.", locked: false },
];

export function loadThreadsDemo(container) {
  container.innerHTML = "";
  header(container, DEMO.length, DEMO.filter((v) => !v.locked).length);
  const list = mk("div", "thr-list");
  DEMO.forEach((v) => list.appendChild(renderRow(v, (vv, opts, row) => { markLocked(row, opts.vault); toast("מצב הדגמה · נעול → " + vaultLabel(opts.vault)); })));
  container.appendChild(list);
  container.appendChild(mk("p", "hint", "מצב הדגמה - נעילה מסומנת מקומית בלבד, ללא כתיבה ל-OneDrive."));
}
