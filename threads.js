// Live threads dispatcher - the heart of בית עלמא.
// Reads the inbox live via Graph, shows each thread with a vault picker, and a
// "✓ נעל" button that writes the lock contract straight into the file's
// frontmatter. The frontmatter mutation MIRRORS worker/lock.py EXACTLY so the
// scheduled `distribute.py --locked-only` files it identically:
//     locked: true
//     locked_vault: <slug>
//     locked_at: YYYY-MM-DD HH:MM
import { listInbox, getFileText, putFileReplace } from "./graph.js";
import { toast } from "./ui.js";

// Valid lock targets - the 9 vault slugs from lock.py (VAULTS). "alma-threads"
// means "leave in inbox". "pool"/unsorted is NOT a lock target.
const VAULT_OPTIONS = [
  ["alma-r", "Alma.R"], ["alma-r-proj", "Alma.R.Proj"], ["alma-health", "Alma.Health"],
  ["alma-invest", "Alma.Invest"], ["alma-finance", "Alma.Finance"], ["alma-daily", "Alma.Daily"],
  ["alma-research", "Alma.Research"], ["alma-adinveod", "AdinVeod"], ["alma-threads", "השאר ב-inbox"],
];
const KIND_HE = { voice: "קול", photo: "תמונה", text: "טקסט", link: "לינק" };

// ---- frontmatter helpers (mirror lock.py parse_note / fm_set / write_atomic) ----
function parseNote(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { fm: null, body: text };
  return { fm: m[1].split(/\r?\n/), body: text.slice(m[0].length) };
}
function fmGet(fm, key) {
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
  const m = body.match(/##\s*תקציר\s*\r?\n([\s\S]*?)(?:\r?\n##|\s*$)/);
  if (m) { const line = m[1].trim().split(/\r?\n/)[0]; if (line) return line; }
  for (const l of body.split(/\r?\n/)) { const t = l.trim(); if (t && !t.startsWith("#")) return t; }
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
    summary: extractSummary(body || ""),
    tags: (get("suggested_tags") || "").replace(/^\[|\]$/g, "").split(",").map((s) => s.trim()).filter(Boolean),
    full: (body || "").trim(),
    locked: get("locked") === "true",
    lockedVault: get("locked_vault"),
  };
}

function vaultLabel(slug) { const f = VAULT_OPTIONS.find(([v]) => v === slug); return f ? f[1] : slug; }

function renderRow(v, onLock) {
  const row = mk("div", "thr"); row.id = "thr-" + v.id;
  row.appendChild(mk("span", "kind", v.kind));
  if (v.time) row.appendChild(mk("span", "time ltr", v.time));
  row.appendChild(mk("span", "sum", v.summary));

  const full = mk("div", "thr-full");
  if (v.full) full.appendChild(mk("div", null, v.full));
  if (v.tags.length) { const c = mk("div", "chips"); v.tags.forEach((t) => c.appendChild(mk("span", "chip", t))); full.appendChild(c); }
  const exp = mk("button", "exp", "+");
  exp.addEventListener("click", () => { const open = full.classList.toggle("open"); exp.textContent = open ? "−" : "+"; });
  row.appendChild(exp);

  if (v.locked) {
    row.classList.add("locked");
    row.appendChild(mk("span", "locked-tag", "נעול → " + vaultLabel(v.lockedVault)));
  } else {
    const sel = mk("select");
    VAULT_OPTIONS.forEach(([slug, label]) => { const o = mk("option", null, label); o.value = slug; if (slug === v.sug) o.selected = true; sel.appendChild(o); });
    row.appendChild(sel);
    const btn = mk("button", "lockbtn", "✓ נעל");
    btn.addEventListener("click", () => onLock(v, sel.value, row, btn));
    row.appendChild(btn);
  }
  row.appendChild(full);
  return row;
}

function markLocked(row, vault) {
  row.classList.add("locked", "just-locked");
  const sel = row.querySelector("select"); if (sel) sel.remove();
  const btn = row.querySelector(".lockbtn"); if (btn) btn.remove();
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
  h.appendChild(mk("span", "over", "מפיץ החוטים"));
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
  views.forEach((v) => list.appendChild(renderRow(v, (vv, vault, row, btn) => doLock(token, vv, vault, row, btn))));
  container.appendChild(list);
  container.appendChild(mk("p", "hint", "נעילה = ‘החלטתי, בצע, אל תראה לי שוב’. החוט יתויק אוטומטית בסבב ההפצה (כל 10 דק’)."));
}

async function doLock(token, v, vault, row, btn) {
  btn.disabled = true; btn.textContent = "נועל…";
  try {
    const text = await getFileText(token, v.name);
    const { fm, body } = parseNote(text);
    if (!fm) { toast("אין frontmatter בקובץ"); btn.disabled = false; btn.textContent = "✓ נעל"; return; }
    fmSet(fm, "locked", "true");
    fmSet(fm, "locked_vault", vault);
    fmSet(fm, "locked_at", nowStamp());
    await putFileReplace(token, v.name, buildNote(fm, body));
    markLocked(row, vault);
    toast("נעול → " + vaultLabel(vault) + " · יתויק בסבב הבא");
  } catch (e) {
    btn.disabled = false; btn.textContent = "✓ נעל";
    toast("נעילה נכשלה: " + e.message);
  }
}

// ---------- demo (local dev, no auth) ----------
const DEMO = [
  { name: "demo-aa11.md", id: "aa11", kind: "קול", time: "17.06 09:14", sug: "alma-research", summary: "רעיון לבדיקה: מסגרת חוצת-תחומים לשיטה כמוצר.", tags: ["method", "product"], full: "תמליל הדגמה. תוכן סינתטי בלבד.", locked: false },
  { name: "demo-bb22.md", id: "bb22", kind: "תמונה", time: "17.06 10:02", sug: "alma-r", summary: "צילום מודעה - אירוע תרבות בשבוע הבא.", tags: ["event"], full: "ניתוח הדגמה. תוכן סינתטי בלבד.", locked: false },
  { name: "demo-cc33.md", id: "cc33", kind: "טקסט", time: "17.06 11:20", sug: "alma-daily", summary: "תזכורת קצרה לסידור בבית.", tags: [], full: "טקסט הדגמה.", locked: false },
];

export function loadThreadsDemo(container) {
  container.innerHTML = "";
  header(container, DEMO.length, DEMO.filter((v) => !v.locked).length);
  const list = mk("div", "thr-list");
  DEMO.forEach((v) => list.appendChild(renderRow(v, (vv, vault, row) => { markLocked(row, vault); toast("מצב הדגמה · נעול → " + vaultLabel(vault)); })));
  container.appendChild(list);
  container.appendChild(mk("p", "hint", "מצב הדגמה - נעילה מסומנת מקומית בלבד, ללא כתיבה ל-OneDrive."));
}
