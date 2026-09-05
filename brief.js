// Home page = the morning brief, rendered live.
// The renderer is extracted verbatim-in-spirit from
// skills/good-morning/tools/brief-template.html (renderAll), adapted to:
//   - render into a passed container (not a fixed #app)
//   - drop the inline interactive triage (that is now the dispatcher page);
//     instead show a compact CTA that routes to #threads
//   - take data live (no embedded encrypted payload / forge)
import { CONFIG } from "./config.js";
import { getDrivePathText, getDrivePathBlob } from "./graph.js";
import { ENGINE_PIPE } from "./engine.js";

const LOGO = "./alma-enso.jpg";

function mk(tag, cls, txt) { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
function listOf(arr) { const u = document.createElement("ul"); arr.forEach((x) => u.appendChild(mk("li", null, x))); return u; }
function detail(label, node) { const d = document.createElement("details"); d.appendChild(mk("summary", null, label)); d.appendChild(node); return d; }
function sec(over) { const s = mk("section"); const h = mk("div", "shead"); h.appendChild(mk("span", "over", over)); h.appendChild(mk("span", "line")); s.appendChild(h); return s; }
function isTime(s) { return /[0-9].*[:\u2013-]/.test(s); }

// minimal block markdown for weekend editions: headings, bullets, paragraphs.
// Mirrors mdInto() in brief-template.html so both surfaces read the same.
function mdInto(root, md) {
  let list = null;
  String(md).split(/\r?\n/).forEach((line) => {
    const t = line.trim();
    if (!t) { list = null; return; }
    const h = t.match(/^(#{1,4})\s+(.*)$/);
    if (h) { list = null; root.appendChild(mk(h[1].length <= 2 ? "h2" : "h3", "ed-h", h[2])); return; }
    if (/^[-*]\s+/.test(t)) {
      if (!list) { list = mk("ul", "ed-l"); root.appendChild(list); }
      list.appendChild(mk("li", null, t.replace(/^[-*]\s+/, ""))); return;
    }
    list = null; root.appendChild(mk("p", "ed-p", t));
  });
}

// צופה-הגרפים (01/08): דף-הדשבורד השבועי נמשך חי מ-OneDrive באותו צינור Graph
// שהבריף עצמו עובר בו, ומוצג ב-iframe מעל האפליקציה - בלי לצאת מה-PWA ובלי
// חשיפה ציבורית. srcdoc הוא same-origin, כך שה-JS הפנימי של הדשבורד רץ כרגיל.
function openGraphsOverlay(token, path) {
  const ov = mk("div", "graphs-overlay");
  const bar = mk("div", "graphs-bar");
  const close = mk("button", "btn-ghost", "✕ סגירה");
  close.type = "button";
  close.addEventListener("click", () => ov.remove());
  bar.appendChild(close);
  bar.appendChild(mk("span", "over", "הסיכום בגרפים"));
  ov.appendChild(bar);
  const body = mk("div", "graphs-body");
  body.appendChild(mk("p", "muted pad", "טוען את הגרפים…"));
  ov.appendChild(body);
  ov.tabIndex = -1;
  ov.addEventListener("keydown", (e) => { if (e.key === "Escape") ov.remove(); });
  document.body.appendChild(ov);
  ov.focus();
  getDrivePathText(token, path).then((html) => {
    body.innerHTML = "";
    if (!html) { body.appendChild(mk("p", "err-msg pad", "דף-הגרפים לא נמצא ב-OneDrive")); return; }
    const fr = document.createElement("iframe");
    fr.className = "graphs-frame";
    fr.setAttribute("title", "הסיכום בגרפים");
    fr.srcdoc = html;
    body.appendChild(fr);
  }).catch((e) => {
    body.innerHTML = "";
    body.appendChild(mk("p", "err-msg pad", "שגיאה בטעינת הגרפים: " + e.message));
  });
}

// jbwv (חלק א): ברכה לפי שעת היום, מחושבת בכל פתיחה. לוגיקת תצוגה טהורה, בלי LLM, אפס עלות.
// מתרעננת אוטומטית עם renderHome בכל חזרה לפורגראונד (ry37), כך שהברכה תמיד תואמת לשעה.
function greeting() {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return "בוקר טוב";
  if (h >= 12 && h < 18) return "צהריים טובים";
  return "ערב טוב";
}

// Truth-stamp helper (19/06 fix, layer B): format the body-build time for humans.
function fmtStamp(iso) {
  try {
    const dt = new Date(iso), now = new Date();
    const hh = String(dt.getHours()).padStart(2, "0"), mm = String(dt.getMinutes()).padStart(2, "0");
    if (dt.toDateString() === now.toDateString()) return `היום ${hh}:${mm}`;
    return `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")} ${hh}:${mm}`;
  } catch { return String(iso); }
}

// Fetch the live brief JSON from OneDrive. Returns parsed data or null (no brief yet).
export async function loadBriefData(token) {
  const txt = await getDrivePathText(token, CONFIG.briefPath);
  if (!txt) return null;
  return JSON.parse(txt);
}

// Demo data for local development (not committed real data).
export async function loadSampleData() {
  const res = await fetch("./brief-sample.json", { cache: "no-store" });
  if (!res.ok) throw new Error("no sample");
  return res.json();
}

// ---------- 21/07: הבריף כמשטח-מצב (חזון אסף מסשן עלמא-הום) ----------
// 1. רצועת חירום עליונה: 0-3 עוצרי-יום בלבד; הורדה בנגיעה מלמדת את הסף.
// 2. "מאז שקראת": ביקור חוזר מציג דלתא, לא את מהדורת הבוקר שוב.
// 3. קופסאות חיות שסופרות: "נשארו 3, סגרת 4", וקופסה ריקה מכריזה שאתה משוחרר.
// 4. מהדורת הבוקר נשארת מקופלת בתחתית אחרי שנקראה ("מהדורת היום").
const VISIT_KEY = "brief-visit";
const DAY_BASE_KEY = "brief-day-base";
const DISMISS_KEY = "brief-urgent-dismissed";
const todayStr = () => new Date().toISOString().slice(0, 10);
function readLS(k, fb) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } }
function writeLS(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* non-fatal */ } }

// day base: the morning's counts, so the boxes can say "סגרת X מאז הבוקר".
function dayBase(liveCounts) {
  let base = readLS(DAY_BASE_KEY, null);
  if (!base || base.date !== todayStr()) {
    base = { date: todayStr(), ...liveCounts };
    writeLS(DAY_BASE_KEY, base);
  }
  return base;
}

// 21/07 בוקר (משוב אסף): קופסה היא דלת תמיד - גם ריקה. "אם יש שם משהו, כשאלחץ
// אגיע ואעבוד בו"; וכשאין, הלחיצה עדיין פותחת את המקום לוודא בעיניים.
function boxCard(label, n, base, onGo, freeText) {
  const b = mk("button", "card cta-card box" + (n === 0 ? " box-done" : ""));
  b.type = "button";
  if (n === 0) {
    b.appendChild(mk("span", "cta-num", "✓"));
    b.appendChild(mk("span", "cta-txt", freeText));
  } else {
    b.appendChild(mk("span", "cta-num", String(n)));
    const closed = base != null && base > n ? base - n : 0;
    b.appendChild(mk("span", "cta-txt", label + (closed > 0 ? ` · סגרת ${closed} מאז הבוקר` : "")));
  }
  b.appendChild(mk("span", "cta-arrow", "←"));
  if (onGo) b.addEventListener("click", onGo);
  return b;
}

export function renderBrief(container, d, { demo = false, onGotoThreads, onRefreshNarrative, live = null, token = null } = {}) {
  container.innerHTML = "";
  const app = container;
  // 31/07 (מסך רחב, עוגן-מחלקה בלבד): שום כלל CSS לא נוגע ב-.brief-surface מתחת
  // ל-900px - האפשור הזה אפס-השפעה על מובייל, ומספק ל-app.css נקודת-אחיזה
  // לפריסת שני-הטורים בדסקטופ (ראה app.css).
  app.classList.add("brief-surface");

  // read-stamp: what did he see last, and is the morning edition already read?
  const builtAt = d.body_built_at || d.generated_at || null;
  const prevVisit = readLS(VISIT_KEY, null);
  writeLS(VISIT_KEY, { at: new Date().toISOString() });
  const alreadyRead = !!(prevVisit && builtAt && new Date(prevVisit.at) > new Date(builtAt));

  // header
  const head = mk("header", "brief-head");
  const g = mk("div", "hgreet");
  const greet = greeting();
  g.appendChild(mk("p", "over", greet));
  const h1 = mk("h1");
  h1.appendChild(document.createTextNode(greet + ", "));
  h1.appendChild(mk("strong", null, "אסף"));
  g.appendChild(h1);
  if (d.date) g.appendChild(mk("p", "muted", d.date));
  if (d.pulse) { const pulse = mk("div", "pulse"); d.pulse.forEach((p) => pulse.appendChild(mk("span", null, p))); g.appendChild(pulse); }
  head.appendChild(g);
  app.appendChild(head);

  // 01/09 (RESTRUCTURE הכרעה 2): מהדורת-רדיו - הבריף שהוקלט על התחנה (הילה+אווה)
  // ומונח בפיד. מתנגן מכל מקום. בלי token (דמו/מנותק) אין נגן - קישור שמת מוסתר (הכרעה 4).
  if (token) {
    const radioWrap = mk("div", "radio-strip");
    app.appendChild(radioWrap);
    (async () => {
      try {
        const manTxt = await getDrivePathText(token, CONFIG.briefPath.replace("brief-latest.json", "brief-radio-latest.json"));
        if (!manTxt) return;
        const man = JSON.parse(manTxt);
        const mins = man.duration_sec ? `${Math.floor(man.duration_sec / 60)}:${String(Math.round(man.duration_sec % 60)).padStart(2, "0")}` : "";
        const btn = mk("button", "radio-btn", `🔊 מהדורת רדיו${mins ? " · " + mins : ""}`);
        radioWrap.appendChild(btn);
        btn.addEventListener("click", async () => {
          btn.disabled = true; btn.textContent = "טוען…";
          try {
            const blob = await getDrivePathBlob(token, CONFIG.briefPath.replace("brief-latest.json", "brief-radio-latest.mp3"));
            if (!blob) throw new Error("no mp3");
            const audio = document.createElement("audio");
            audio.controls = true; audio.src = URL.createObjectURL(blob); audio.autoplay = true;
            audio.className = "radio-audio";
            radioWrap.replaceChild(audio, btn);
          } catch { btn.textContent = "הרדיו לא נטען - נסה שוב"; btn.disabled = false; }
        });
      } catch { /* אין מהדורה בפיד - אין נגן, בשקט */ }
    })();
  }

  if (demo) {
    const banner = mk("div", "demo-banner", "מצב הדגמה · לא מחובר (נתונים סינתטיים)");
    app.appendChild(banner);
  }

  // --- רצועת החירום (0-3): עוצרי-יום בלבד. מקור: d.urgent, או זרקור בטון err.
  // פריט שהורד נרשם ליום הזה - ההורדה היא המורה של הסף.
  {
    const dis = readLS(DISMISS_KEY, {});
    const dismissed = dis.date === todayStr() ? (dis.ids || []) : [];
    // 01/09 הכרעה 3: שורת-העצירה (טיוטות ממתינות, SKILL שלב 1) קודמת לכל - עבודה גמורה שמחכה לשילוח.
    const stops = (d.drafts_waiting || []).map((w, i) => ({ id: "dw-" + i, title: "🛑 " + (typeof w === "string" ? w : (w.title || JSON.stringify(w))), body: (w && w.body) || "" }));
    const src = stops.concat(d.urgent && d.urgent.length ? d.urgent
      : (d.spotlight || []).filter((s) => s.tone === "err").map((s, i) => ({ id: "sp-" + i, title: s.title, body: s.body })));
    const items = src.filter((u) => !dismissed.includes(u.id)).slice(0, 3);
    if (items.length) {
      const strip = mk("div", "urgent-strip");
      // משוב אסף 21/07 בוקר: לחיצה על הקובייה פותחת אותה, ובפנים דלת "טפל בזה"
      // שמובילה למקום הטיפול המיידי. ההורדה קטנה והפיכה - "בטל" מיד, לא היעלמות.
      items.forEach((u) => {
        const btn = mk("button", "urgent-btn"); btn.type = "button";
        btn.appendChild(mk("span", "ub-t", u.title));
        const det = mk("div", "urgent-det"); det.hidden = true;
        if (u.body) det.appendChild(mk("p", "muted", u.body));
        const actRow = mk("div", "ub-actions");
        // 28/07 (תלונת אסף "לוחץ על מחבר ומגיע לדף מת, בלי אפילו שגיאה"): הכפתור
        // קרא ל-window.open אחרי import ו-await. דפדפני נייד חוסמים בשקט פתיחת חלון
        // שאינה בתוך הלחיצה עצמה, ולכן שום דבר לא קרה ושום שגיאה לא הוצגה.
        // עכשיו זה קישור אמיתי: ניווט טבעי שלא נחסם. יעד ברירת-המחדל הוא חדר-המכונות
        // שבתוך האפליקציה (#engine), שנטען מהענן ולכן תמיד נראה מהטלפון.
        const treat = mk("a", "btn-primary ub-treat", "טפל בזה ←");
        treat.href = u.url || "#engine";
        if (u.url) { treat.target = "_blank"; treat.rel = "noopener"; }
        treat.style.display = "inline-block"; treat.style.textDecoration = "none";
        treat.addEventListener("click", (e) => e.stopPropagation());
        actRow.appendChild(treat);
        if (!u.url) {
          const room = mk("a", "btn-ghost ub-room", "חדר המכונות המלא ←");
          room.href = ENGINE_PIPE + "/hub"; room.target = "_blank"; room.rel = "noopener";
          room.title = "דרך הצינור הפרטי · דורש Tailscale מחובר";
          room.style.display = "inline-block"; room.style.textDecoration = "none";
          room.addEventListener("click", (e) => e.stopPropagation());
          actRow.appendChild(room);
        }
        const demote = mk("button", "btn-ghost ub-demote", "לא עוצר-יום · הורד"); demote.type = "button";
        demote.addEventListener("click", (e) => {
          e.stopPropagation();
          const cur = readLS(DISMISS_KEY, {});
          const ids = cur.date === todayStr() ? (cur.ids || []) : [];
          ids.push(u.id);
          writeLS(DISMISS_KEY, { date: todayStr(), ids });
          btn.hidden = true; det.hidden = true;
          const undo = mk("button", "btn-ghost ub-undo", "הורד מהרצועה · בטל"); undo.type = "button";
          undo.addEventListener("click", () => {
            const c2 = readLS(DISMISS_KEY, {});
            writeLS(DISMISS_KEY, { date: todayStr(), ids: (c2.ids || []).filter((x) => x !== u.id) });
            undo.remove(); btn.hidden = false;
          });
          strip.appendChild(undo);
        });
        actRow.appendChild(demote);
        det.appendChild(actRow);
        btn.addEventListener("click", () => { det.hidden = !det.hidden; });
        strip.appendChild(btn); strip.appendChild(det);
      });
      app.appendChild(strip);
    }
    // mark promoted spotlight items so the edition below doesn't show them twice
    d._promoted = new Set(items.filter((u) => String(u.id).startsWith("sp-")).map((u) => Number(String(u.id).slice(3))));
  }

  // --- "מאז שקראת": ביקור חוזר פותח בדלתא, לא בחזרה על הבוקר.
  if (alreadyRead) {
    const since = mk("div", "since-card card");
    const bits = [];
    if (live) {
      const base = dayBase(live);
      const closedT = base.threads != null && live.threads != null && base.threads > live.threads ? base.threads - live.threads : 0;
      if (closedT) bits.push(`סגרת ${closedT} חוטים`);
      if (live.threads) bits.push(`${live.threads} חוטים פתוחים`);
      if (live.questions) bits.push(`${live.questions} שאלות`);
      if (live.actions) bits.push(`${live.actions} ממתינות לך`);
    }
    since.appendChild(mk("div", "phead", "מאז שקראת · " + fmtStamp(prevVisit.at)));
    since.appendChild(mk("div", "muted", bits.length ? bits.join(" · ") : "שקט. שום דבר חדש שדורש אותך."));
    app.appendChild(since);
  }

  // truth-stamp (19/06 fix, layer B): when was the body last rebuilt, and is it stale?
  // The daemon flags body_stale; we also recompute from age as a client-side backup,
  // so the brief can never silently show yesterday's thinking again.
  {
    const builtAt = d.body_built_at || d.generated_at;
    let stale = d.body_stale === true;
    if (!stale && builtAt) {
      const ageH = (Date.now() - new Date(builtAt).getTime()) / 3.6e6;
      if (isFinite(ageH) && ageH >= 20) stale = true;
    }
    if (builtAt || stale) {
      const stamp = mk("div", "brief-stamp" + (stale ? " stale" : ""));
      stamp.appendChild(mk("span", "bs-when", (stale ? "⚠ הגוף לא רוענן · " : "עודכן · ") + (builtAt ? fmtStamp(builtAt) : "לא ידוע")));
      if (stale) stamp.appendChild(mk("span", "bs-msg", "אמור 'בוקר טוב' לבריף מעודכן."));
      app.appendChild(stamp);
    }
  }

  // jbwv (ב): on-demand narrative refresh. Fires ONLY on press (pay-per-use).
  // The state above (greeting, counts, threads, calendar) is already live & free;
  // this rebuilds the written narrative on demand via the local daemon.
  if (!demo && onRefreshNarrative) {
    const wrap = mk("div", "brief-refresh");
    const btn = mk("button", "btn-ghost refresh-btn"); btn.type = "button";
    btn.textContent = "🔄 רענן נרטיב";
    const status = mk("span", "refresh-status muted");
    btn.addEventListener("click", () => {
      btn.disabled = true; btn.textContent = "מרענן…";
      onRefreshNarrative((msg, done) => {
        status.textContent = msg || "";
        if (done) { btn.disabled = false; btn.textContent = "🔄 רענן נרטיב"; }
      });
    });
    wrap.appendChild(btn); wrap.appendChild(status);
    app.appendChild(wrap);
  }

  // budget banner (19/06): API credit at 80% -> decide on renewal; empty -> body can't self-refresh.
  if (d.credit_low || d.budget_warn) {
    const bd = d.budget || {};
    const b = mk("div", "brief-budget" + (d.credit_low ? " out" : " warn"));
    b.textContent = d.credit_low
      ? "⚠ קרדיט ה-API אזל · הגוף לא יתרענן לבד עד שתחדש"
      : `תקציב ה-API ב-${bd.pct != null ? bd.pct : 80}% ($${bd.spent != null ? bd.spent : "?"} מתוך $${bd.budget != null ? bd.budget : 5}) · החלט על חידוש`;
    app.appendChild(b);
  }

  // today
  if (d.today && d.today.length) {
    let s = sec("היום");
    d.today.forEach((t) => {
      const c = mk("div", "card"); const r = mk("div", "row"); const w = mk("div", "when");
      w.appendChild(isTime(t.when) ? mk("span", "ltr", t.when) : document.createTextNode(t.when));
      r.appendChild(w); r.appendChild(mk("div", "what", t.what)); c.appendChild(r); s.appendChild(c);
    });
    app.appendChild(s);
  }

  // upcoming (heads-up: tomorrow + week ahead; all-day items like birthdays/fasts get advance notice)
  if (d.upcoming && d.upcoming.length) {
    let s = sec("קרוב · ימים הבאים");
    d.upcoming.forEach((u) => {
      const c = mk("div", "card"); const r = mk("div", "row"); const w = mk("div", "when");
      w.appendChild(isTime(u.when) ? mk("span", "ltr", u.when) : document.createTextNode(u.when || ""));
      r.appendChild(w);
      const what = mk("div", "what");
      if (u.day) what.appendChild(mk("strong", null, u.day + " "));
      what.appendChild(document.createTextNode(u.what));
      r.appendChild(what); c.appendChild(r); s.appendChild(c);
    });
    app.appendChild(s);
  }

  // --- הקופסאות החיות: סופרות, פותחות דלת, ומכריזות על מותן ("אתה משוחרר").
  {
    const lv = live || {};
    const tN = lv.threads != null ? lv.threads : (d.threads ? d.threads.length : null);
    const s = sec("הקופסאות");
    s.classList.add("sec-boxes"); // עוגן-מחלקה בלבד - ראה app.css, אפס כלל מתחת ל-900px
    const base = lv.threads != null ? dayBase(lv) : {};
    if (tN != null) s.appendChild(boxCard("חוטים ממתינים למיון", tN, base.threads, onGotoThreads, "הנול נקי · אתה משוחרר"));
    if (lv.questions != null) s.appendChild(boxCard("שאלות פתוחות", lv.questions, base.questions, onGotoThreads, "אין שאלות פתוחות · הכול נסגר"));
    if (lv.actions != null) s.appendChild(boxCard("ממתינות לך", lv.actions, base.actions, onGotoThreads, "שום דבר לא ממתין לך"));
    if (s.childNodes.length > 1) app.appendChild(s);
  }

  // --- מהדורת הבוקר: אחרי שנקראה היא מתקפלת לתחתית כ"מהדורת היום".
  const edRoot = alreadyRead ? mk("div") : app;

  // weekend edition (spec 13/07): REPLACES the weekday body, the skeleton stays.
  // 17/07: this surface never knew the field, so every Friday/Saturday it served
  // Thursday's fronts/spotlight/cards and dropped the edition on the floor.
  const hasEdition = !!(d.edition && d.edition.md);
  if (hasEdition) {
    let s = sec(d.edition.title || "מהדורת סוף-שבוע");
    const c = mk("div", "card");
    // 01/08: קישור-הגרפים שבגוף ה-md הוא נתיב-דיסק יחסי - מת מהטלפון. כשהצינור
    // מצהיר graphsFile (נתיב OneDrive), הכפתור למטה מחליף אותו והשורה לא מרונדרת.
    const gfile = d.edition.graphsFile || null;
    mdInto(c, gfile ? String(d.edition.md).replace(/^▶\s*\*\*\[.*$/m, "") : d.edition.md);
    s.appendChild(c);
    if (gfile && token) {
      const gb = mk("button", "card cta-card graphs-cta");
      gb.type = "button";
      gb.appendChild(mk("span", "cta-txt", "הסיכום המלא בגרפים · שני הבריפים כתמונה אחת"));
      gb.appendChild(mk("span", "cta-arrow", "←"));
      gb.addEventListener("click", () => openGraphsOverlay(token, gfile));
      s.appendChild(gb);
    }
    s.appendChild(mk("p", "hint", "מהדורת צופים · " + (d.edition.file || "")));
    edRoot.appendChild(s);
  }


  // spotlight (מדלג על מה שכבר קודם לרצועת-החירום - מידע לא מופיע פעמיים)
  if (!hasEdition && d.spotlight && d.spotlight.length) {
    const rest = d.spotlight.filter((sp, i) => !(d._promoted && d._promoted.has(i)));
    if (rest.length) {
      let s = sec("דחוף · זרקור");
      rest.forEach((sp) => {
        const c = mk("div", "card"); c.style.borderInlineStart = "3px solid var(--" + sp.tone + ")";
        c.appendChild(mk("h2", null, sp.title)); c.appendChild(mk("div", "muted", sp.body)); s.appendChild(c);
      });
      edRoot.appendChild(s);
    }
  }

  // drill-down cards
  if (!hasEdition && d.cards && d.cards.length) {
    let s = sec("פירוט · drill-down");
    d.cards.forEach((o) => {
      const c = mk("div", "card"); c.appendChild(mk("h2", null, o.title)); c.appendChild(mk("div", "phead", o.head));
      if (o.facts && o.facts.length) c.appendChild(listOf(o.facts));
      if (o.numbers && o.numbers.length) c.appendChild(detail("מספרים", listOf(o.numbers)));
      if (o.sources && o.sources.length) c.appendChild(detail("מקורות", listOf(o.sources)));
      if (o.next) c.appendChild(detail("הצעד הבא", mk("div", "dtxt", o.next)));
      if (o.related) c.appendChild(detail("קשור", mk("div", "dtxt", o.related)));
      if (o.trigger) { const t = mk("div", "trig-line"); t.appendChild(mk("span", "tag trig", o.trigger)); c.appendChild(t); }
      s.appendChild(c);
    });
    edRoot.appendChild(s);
  }

  // fronts = שאלות אליך. 05/09/2026 (אסף): לא בראש הבריף, לכל היותר 3, בקופסה משלהן מתחת לעבודה.
  // הראש שמור לרצועת-החירום (0-3 עוצרי-יום) בלבד.
  if (!hasEdition && d.fronts && d.fronts.length) {
    let s = sec("שאלות אליך · עד 3");
    const fc = mk("div", "card");
    d.fronts.slice(0, 3).forEach((f) => {
      const nrow = mk("div", "num"); nrow.appendChild(mk("div", "n", String(f.n)));
      const b = mk("div", "b"); const h2 = mk("h2");
      h2.appendChild(document.createTextNode(f.title + " "));
      if (f.asap) h2.appendChild(mk("span", "tag asap", "ASAP"));
      b.appendChild(h2); b.appendChild(mk("div", "muted", f.body));
      if (f.trigger) { const tl = mk("div", "trig-line"); tl.appendChild(mk("span", "tag trig", f.trigger)); b.appendChild(tl); }
      nrow.appendChild(b); fc.appendChild(nrow);
    });
    s.appendChild(fc);
    if (d.frontsNote) s.appendChild(mk("p", "hint", d.frontsNote));
    edRoot.appendChild(s);
  }

  // mail - דלת, לא טקסט (משוב אסף 21/07): לחיצה פותחת את התיבה עצמה.
  if (d.mail) {
    let s = sec("מייל");
    const c = mk("button", "card cta-card"); c.type = "button";
    c.appendChild(mk("span", "cta-txt", d.mail));
    c.appendChild(mk("span", "cta-arrow", "←"));
    c.addEventListener("click", () => window.open("https://outlook.office.com/mail/", "_blank", "noopener"));
    s.appendChild(c); edRoot.appendChild(s);
  }

  // services
  if (d.services && d.services.length) {
    // 01/09 צ'אנק ג: וולטים ו-gated - שני השדות שהרנדרר לא הציג (פער-הפיד נסגר כאן)
    if ((d.vaults && d.vaults.length) || (d.gated && d.gated.length)) {
      let s = sec("וולטים");
      const c = mk("div", "card");
      if (d.vaults && d.vaults.length) {
        const names = d.vaults.map((v) => Array.isArray(v) ? (v[1] || v[0]) : String(v));
        c.appendChild(mk("p", "muted", names.join(" · ")));
      }
      (d.gated || []).forEach((g) => c.appendChild(mk("p", "muted", "🔒 " + (typeof g === "string" ? g : (g.title || JSON.stringify(g))))));
      s.appendChild(c); app.appendChild(s);
    }
    let s = sec("שירותים"); const c = mk("div", "card"); const box = mk("div", "muted");
    d.services.forEach((x, i) => { if (i) box.appendChild(document.createElement("br")); box.appendChild(document.createTextNode(x)); });
    c.appendChild(box); s.appendChild(c); edRoot.appendChild(s);
  }

  // do / dont (weekday body; hidden on edition days)
  if (!hasEdition && (d.doList || d.dontList)) {
    let s = sec("מה כדאי · מה לא כדאי היום");
    const dd = mk("div", "dd");
    const doCol = mk("div", "col do"); doCol.appendChild(mk("h3", null, "כדאי"));
    (d.doList || []).forEach((x) => { const li = mk("li"); li.appendChild(mk("span", "mk", "↑")); li.appendChild(mk("span", null, x)); doCol.appendChild(li); });
    const dontCol = mk("div", "col dont"); dontCol.appendChild(mk("h3", null, "לא כדאי"));
    (d.dontList || []).forEach((x) => { const li = mk("li"); li.appendChild(mk("span", "mk", "×")); li.appendChild(mk("span", null, x)); dontCol.appendChild(li); });
    dd.appendChild(doCol); dd.appendChild(dontCol); s.appendChild(dd); edRoot.appendChild(s);
  }

  // the fold itself: on a revisit, the whole morning edition sits collapsed at the bottom.
  if (alreadyRead && edRoot !== app && edRoot.childNodes.length) {
    const fold = document.createElement("details");
    fold.className = "ed-fold";
    const sum = document.createElement("summary");
    sum.textContent = "מהדורת היום · כבר קראת";
    fold.appendChild(sum);
    fold.appendChild(edRoot);
    app.appendChild(fold);
  }

  // 01/09 הכרעה 4 (מדיניות-קישורים): קישור מקומי-בלבד (localhost/127/file) מת בכל
  // משטח שאינו התחנה - שם הוא מוחלף בתווית שקטה במקום שורה-מתה לוחצת.
  const LOCAL_SURFACE = ["127.0.0.1", "localhost"].includes(location.hostname);
  if (!LOCAL_SURFACE) {
    app.querySelectorAll("a[href]").forEach((a) => {
      if (/^(https?:\/\/(127\.|localhost)|file:)/.test(a.href)) {
        a.replaceWith(mk("span", "muted", a.textContent.replace(/\s*←\s*$/, "") + " · זמין בתחנה"));
      }
    });
  }

  // 01/09 הכרעה 3 (רזה-קודם): במסך צר, כל סקשן אחרי היום/קרוב מתקפל למרחיב.
  // שום מידע לא נמחק - רק הסדר. בדסקטופ הכל נשאר פרוש.
  if (!window.matchMedia("(min-width: 900px)").matches) {
    const KEEP_OPEN = new Set(["היום", "קרוב · ימים הבאים"]);
    app.querySelectorAll("section").forEach((secEl) => {
      const over = secEl.querySelector(".shead .over");
      if (!over || KEEP_OPEN.has(over.textContent)) return;
      const det = document.createElement("details");
      det.className = "fold-sec";
      const sum = document.createElement("summary");
      sum.textContent = over.textContent;
      det.appendChild(sum);
      secEl.parentNode.insertBefore(det, secEl);
      const sh = secEl.querySelector(".shead");
      if (sh) sh.remove();
      det.appendChild(secEl);
    });
  }
  app.appendChild(mk("p", "disc", "פחות, אבל טוב יותר"));
}
