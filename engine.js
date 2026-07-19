// חדר המכונות בכיס (19/07): הלוח וההכרעות עוברים תמיד ב-Graph (graph.js), באותו
// צינור מאובטח שהלכידה משתמשת בו - בלי שום חשיפת-רשת של השרת המקומי. "המכונה
// בהישג יד" (v1, שהיה גוף renderEngine ב-app.js) עבר לכאן כרכיב עצמאי בראש העמוד:
// הוא בודק רשת מקומית (127.0.0.1:8861) ולא תלוי בטוקן - נשאר fetch ישיר ולא דרך
// graph.js בכוונה, כי זה בכלל לא Graph/OneDrive, זו בדיקת-נוכחות מול המכונה עצמה.
import { getDrivePathText, putDrivePathText } from "./graph.js";
import { CONFIG } from "./config.js";
import { toast, micButton } from "./ui.js";

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
    const b = mk("button", "btn-primary"); b.textContent = "פתח את חדר המכונות";
    b.addEventListener("click", () => window.open(ENGINE_LOCAL + "/hub", "_blank", "noopener"));
    box.appendChild(p); box.appendChild(b);
  } else {
    const p1 = mk("p", "muted");
    p1.textContent = "חדר-המכונות רץ על המכונה בבית וסגור לרשת מטעמי אבטחה, אז מהמכשיר הזה אין קו ישיר.";
    box.appendChild(p1);
  }
}

// ---------- לוח-הענן + הכרעות ----------
const DECIDED_KEY = "engine-decided";       // { [id]: {verdict, note, at} } - עד שהלוח כבר לא כולל את ה-id
const DRAFT_KEY = "engine-note-draft";      // { [id]: text } - טיוטת הערה, נמחקת אחרי שליחה מוצלחת

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

function markDecidedUI(row, verdict, note, demo) {
  const ta = row.querySelector("textarea"); if (ta) ta.remove();
  const recRow = row.querySelector(".rec-row"); if (recRow) recRow.remove();
  const yn = row.querySelector(".eng-yn"); if (yn) yn.remove();
  const label = (demo ? "מצב הדגמה · " : "") + "נרשם: " + (verdict === "yes" ? "כן" : "לא") + (note ? " · ההערה שלך: " + note : "") + (demo ? "" : " · ממתין לעדכון בלוח");
  row.appendChild(mk("span", "locked-tag", label));
}

async function submitDecision(it, verdict, note, ctx, row, buttons) {
  buttons.forEach((b) => { b.disabled = true; });
  const cleanNote = (note || "").trim();

  if (ctx.demo) {
    clearDraft(it.id);
    markDecidedUI(row, verdict, cleanNote, true);
    toast("מצב הדגמה · נרשם: " + (verdict === "yes" ? "כן" : "לא") + (cleanNote ? " · ההערה שלך: " + cleanNote : ""));
    return;
  }

  const at = new Date().toISOString();
  const payload = { id: it.id, verdict, note: cleanNote, at, src: "phone" };
  const fname = `decide-${Date.now()}-${it.id}.json`;
  try {
    await putDrivePathText(ctx.token, `${CONFIG.engineInboxPath}/${fname}`, JSON.stringify(payload, null, 2));
  } catch (e) {
    buttons.forEach((b) => { b.disabled = false; });
    toast("שליחת ההכרעה נכשלה · " + friendlyErr(e));
    return;
  }

  const decided = readJSON(DECIDED_KEY, {});
  decided[it.id] = { verdict, note: cleanNote, at };
  writeJSON(DECIDED_KEY, decided);
  clearDraft(it.id);

  markDecidedUI(row, verdict, cleanNote, false);
  toast("נרשם: " + (verdict === "yes" ? "כן" : "לא") + (cleanNote ? " · ההערה שלך: " + cleanNote : ""));
}

function renderAwaitingItem(it, ctx) {
  const row = mk("div", "thr");
  const already = ctx.decided[it.id];

  const head = mk("div", "thr-head-row"); head.style.cursor = "default";
  head.appendChild(mk("span", "sum", it.title || "(ללא כותרת)"));
  row.appendChild(head);

  if (it.detail) row.appendChild(mk("div", "thr-body", it.detail));
  if (it.recommendation) row.appendChild(mk("div", "thr-body eng-rec", "מומלץ: " + it.recommendation));

  if (already) {
    row.appendChild(mk("span", "locked-tag", "נרשם מקומית: " + (already.verdict === "yes" ? "כן" : "לא")
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
  yes.addEventListener("click", () => submitDecision(it, "yes", ta.value, ctx, row, [yes, no]));
  no.addEventListener("click", () => submitDecision(it, "no", ta.value, ctx, row, [yes, no]));
  btnRow.appendChild(yes); btnRow.appendChild(no);
  row.appendChild(btnRow);

  return row;
}

function renderAwaitingSection(items, ctx) {
  const sec = mk("section");
  const sh = mk("div", "shead");
  sh.appendChild(mk("span", "over", "ממתין לך"));
  sh.appendChild(mk("span", "line"));
  sh.appendChild(mk("span", "thr-count", items.length ? String(items.length) : "✓"));
  sec.appendChild(sh);

  if (!items.length) {
    sec.appendChild(mk("div", "card empty", "אין החלטות שממתינות לך כרגע. ✓"));
    return sec;
  }

  const list = mk("div", "thr-list");
  items.forEach((it) => {
    try { list.appendChild(renderAwaitingItem(it, ctx)); }
    catch (e) { list.appendChild(mk("div", "thr err-msg", "פריט לא תקין בלוח: " + (e.message || ""))); }
  });
  sec.appendChild(list);
  sec.appendChild(mk("p", "hint", "כן/לא נשלח מיד עם ההערה שלך (אם כתבת). ההכרעה מסומנת גם במכשיר הזה עד שהלוח יתעדכן."));
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

function renderLockedSection(items) {
  const sec = mk("section");
  const sh = mk("div", "shead");
  sh.appendChild(mk("span", "over", "הכרעות נעולות"));
  sh.appendChild(mk("span", "line"));
  sh.appendChild(mk("span", "thr-count", String(items.length)));
  sec.appendChild(sh);

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
  container.appendChild(renderLockedSection((board.locked || []).slice(0, 30)));

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
