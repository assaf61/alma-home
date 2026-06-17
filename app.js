// בית עלמא controller: auth state, hash routing, page rendering.
// Live mode (signed in) fetches everything from the user's private OneDrive via
// Graph. Not signed in -> a login gate, plus a demo button so the UI can be
// inspected locally without an interactive Microsoft login.
import { initAuth, account, signIn, getToken, configured } from "./auth.js";
import { renderBrief, loadBriefData, loadSampleData } from "./brief.js";
import { loadThreads, loadThreadsDemo } from "./threads.js";

const pages = {
  home: document.getElementById("page-home"),
  threads: document.getElementById("page-threads"),
};

function mk(tag, cls, txt) { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }

function setAuthChip() {
  const chip = document.getElementById("chip-auth");
  if (account()) { chip.textContent = "מחובר"; chip.classList.add("ok"); }
  else { chip.textContent = "התחבר"; chip.classList.remove("ok"); }
}

function showPage(route) {
  Object.entries(pages).forEach(([k, el]) => el.classList.toggle("active", k === route));
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.route === route));
  window.scrollTo(0, 0);
}

function loginGate(container, onDemo) {
  container.innerHTML = "";
  const gate = mk("div", "gate");
  const img = mk("img"); img.src = "./alma-mark.png"; img.alt = "עלמא"; gate.appendChild(img);
  gate.appendChild(mk("p", "over", "בית עלמא"));
  gate.appendChild(mk("h1", "gate-h1", "ברוך הבא, אסף"));
  gate.appendChild(mk("p", "muted", "התחבר עם חשבון Microsoft שלך כדי לראות את הבריף והחוטים."));
  const login = mk("button", "btn-primary", "התחבר עם Microsoft");
  login.addEventListener("click", () => signIn());
  gate.appendChild(login);
  const demo = mk("button", "btn-ghost", "צפה בהדגמה");
  demo.addEventListener("click", onDemo);
  gate.appendChild(demo);
  if (!configured()) gate.appendChild(mk("p", "err-msg", "אזהרה: clientId לא מוגדר."));
  container.appendChild(gate);
}

async function gotoThreads() { location.hash = "#threads"; }

async function renderHome() {
  const c = pages.home;
  c.innerHTML = "<p class='muted pad'>טוען בריף…</p>";
  const token = await getToken();
  if (token) {
    try {
      const data = await loadBriefData(token);
      if (data) { renderBrief(c, data, { onGotoThreads: gotoThreads }); return; }
      c.innerHTML = "";
      const e = mk("div", "card empty");
      e.appendChild(mk("h2", null, "אין בריף להיום עדיין"));
      e.appendChild(mk("p", "muted", "הבריף נוצר בבוקר ע\"י good-morning ונכתב ל-OneDrive. בינתיים אפשר לעבור לחוטים."));
      const go = mk("button", "btn-ghost", "מעבר לחוטים ←");
      go.addEventListener("click", gotoThreads);
      e.appendChild(go);
      c.appendChild(e);
      return;
    } catch (err) { c.innerHTML = "<p class='err-msg pad'>שגיאת בריף: " + err.message + "</p>"; return; }
  }
  loginGate(c, async () => {
    c.innerHTML = "<p class='muted pad'>טוען הדגמה…</p>";
    try { renderBrief(c, await loadSampleData(), { demo: true, onGotoThreads: gotoThreads }); }
    catch { c.innerHTML = "<p class='err-msg pad'>הדגמה לא זמינה</p>"; }
  });
}

async function renderThreads() {
  const c = pages.threads;
  c.innerHTML = "<p class='muted pad'>טוען חוטים…</p>";
  const token = await getToken();
  if (token) { await loadThreads(token, c); return; }
  loginGate(c, () => loadThreadsDemo(c));
}

async function route() {
  const r = (location.hash || "#home").replace("#", "");
  const known = pages[r] ? r : "home";
  showPage(known);
  if (known === "home") await renderHome();
  else if (known === "threads") await renderThreads();
}

async function main() {
  // service worker (offline shell)
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
  await initAuth();
  setAuthChip();

  document.getElementById("chip-auth").addEventListener("click", () => { if (!account()) signIn(); });
  document.querySelectorAll(".nav-btn").forEach((b) => b.addEventListener("click", () => { location.hash = "#" + b.dataset.route; }));
  window.addEventListener("hashchange", route);
  await route();
}

main();
