// חדר המכונות (21/07, הכרעת אסף): לא עוד "צילום כיס" של החדר - דלת אל החדר האמיתי.
// החדר החי (הדלפק, הנול, המראה, השומר) רץ על שרת השומר במחשב (8861). מהמחשב עצמו
// הדלת היא localhost; מהטלפון היא הצינור הפרטי (Tailscale): tailscaled מגיש את
// 127.0.0.1:8861 לרשת הפרטית דרך serve (פורט 80), כך ששום פורט לא נפתח לעולם.
// רשימות-הכיס (לוח/מעבר-עיניים/נול כנייר מת) הוסרו בהוראת אסף - "רשימה אינסופית
// שאין מה לעשות איתה". גשר-הענן לכתיבה (inbox) נשאר חי בצד השרת למקרי קצה.
//
// הערת דפדפן: מ-HTTPS מותר לגשת ל-127.0.0.1 (חריג loopback), אבל אסור fetch אל
// http://tailnet (mixed content) - לכן מהטלפון אין בדיקת-נוכחות, יש דלת ישירה.
// כשיופעל HTTPS בצינור (קליק באדמין של Tailscale), נשדרג לבדיקה חיה + הטמעה פנימית.

function mk(tag, cls, txt) { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }

const ENGINE_LOCAL = "http://127.0.0.1:8861";
const ENGINE_PIPE = "http://almapm.tailfd019a.ts.net";
const ENGINE_PIPE_IP = "http://100.117.118.84";

const ROOMS = [
  { key: "hub", label: "הדלפק", what: "ממתין לך, הכרעות, מצב חי" },
  { key: "loom", label: "הנול", what: "החוטים והכרעות-העומק" },
  { key: "mirror", label: "המראה", what: "מפת המכונה החיה" },
  { key: "", label: "השומר", what: "דגלים, סריקות, חוזים" },
];

async function localUp() {
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 1500);
    const r = await fetch(ENGINE_LOCAL + "/hub-data", { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(t); return r.ok;
  } catch { return false; }
}

// הבסיס הנכון לרגע זה: המכונה עצמה אם היא בהישג יד, אחרת הצינור הפרטי.
export async function engineBase() { return (await localUp()) ? ENGINE_LOCAL : ENGINE_PIPE; }

export async function renderEngineRoom(container) {
  container.innerHTML = "";
  const box = mk("div", "card");
  const h = mk("div", "shead");
  h.appendChild(mk("span", "over", "חדר המכונות"));
  h.appendChild(mk("span", "line"));
  box.appendChild(h);
  const status = mk("p", "muted", "בודק את הדרך אל החדר…");
  box.appendChild(status);
  container.appendChild(box);

  const isLocal = await localUp();
  const base = isLocal ? ENGINE_LOCAL : ENGINE_PIPE;
  status.remove();

  const p = mk("p", "muted", isLocal
    ? "אתה על המכונה עצמה. החדר בהישג יד."
    : "הדרך אל החדר: הצינור הפרטי. ודא ש-Tailscale דולק במכשיר הזה.");
  box.appendChild(p);

  const doors = mk("div", "doors");
  ROOMS.forEach((r) => {
    const b = mk("button", "door");
    b.appendChild(mk("span", "door-t", r.label));
    b.appendChild(mk("span", "door-s", r.what));
    b.addEventListener("click", () => window.open(base + "/" + r.key, "_blank", "noopener"));
    doors.appendChild(b);
  });
  box.appendChild(doors);

  if (!isLocal) {
    const alt = mk("p", "muted small");
    alt.appendChild(document.createTextNode("הדלת לא נפתחת? נסה דרך "));
    const a = mk("a", null, "הכתובת הישירה");
    a.href = ENGINE_PIPE_IP + "/hub"; a.target = "_blank"; a.rel = "noopener";
    alt.appendChild(a);
    alt.appendChild(document.createTextNode(" או ודא ש-Tailscale מחובר."));
    box.appendChild(alt);
  }
}
