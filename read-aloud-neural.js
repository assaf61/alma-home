/*
 * alma read-aloud NEURAL (הקרא לי · נוירוני) — dual-voice, intra-sentence language switching.
 * Default read-aloud for Alma HTML when the guard server (8861) is up. Assaf: ADHD/dyslexia, works by ear.
 *
 * Why this exists: the plain read-aloud.js uses the browser SpeechSynthesis (metallic SAPI5 on Assaf's
 * Chrome). This one streams natural Microsoft-Neural mp3 from edge-tts via the guard server, using the
 * pair Assaf chose (08/07/2026): Hila for Hebrew, Ava for English — and it SWITCHES between them
 * inside a single sentence, fragment by fragment, because his content mixes Hebrew prose with English
 * terms (Fable, workflow, security-sweep, GPT-5.6).
 *
 * Transport: each block is split into single-language runs; each run is synthesized by the server (which
 * picks Hila/Ava by the run's own script) and played in order with one-block lookahead, so the switch is
 * seamless. Falls back to browser SpeechSynthesis if the server is unreachable, so the page never breaks.
 *
 * Controls (11/07/2026, per Assaf): pause REMEMBERS position — resume continues from the exact spot, it
 * never jumps to the top. ⏮/⏭ step one block back/forward ("a notch") so he can hear this part or another.
 * ↺ restarts from the beginning only when explicitly pressed. There is no auto-resetting "stop".
 *
 * Config: window.RA_TTS = 'http://127.0.0.1:8861/loom-tts' (default). window.RA_SEL to tune blocks.
 * Endpoint contract: POST {text} → audio/mpeg. Sent text/plain to stay a CORS "simple request".
 */
(function boot() {
  if (window.__readAloud) return; window.__readAloud = true;
  var TTS = window.RA_TTS || 'http://127.0.0.1:8861/loom-tts';

  if (!document.getElementById('ra-css')) {
  var css = document.createElement('style');
  css.id = 'ra-css';
  css.textContent =
    '.ra-bar{position:fixed;inset-inline-start:18px;inset-block-end:18px;z-index:9999;display:flex;align-items:center;gap:6px;background:#fff;border:1px solid #E6E1D7;border-radius:999px;padding:8px 10px;box-shadow:0 6px 24px rgba(40,38,32,.16);direction:rtl;font-family:inherit}'
  + '.ra-bar button{border:none;background:#EEF2EC;color:#2C2C28;cursor:pointer;border-radius:999px;padding:9px 12px;font:inherit;font-size:14px;line-height:1;display:flex;align-items:center;gap:6px}'
  + '.ra-bar button:hover{background:#E1E8DE}'
  + '.ra-bar button:disabled{opacity:.4;cursor:default}'
  + '.ra-bar .ra-primary{background:#7C8B77;color:#fff;padding:10px 16px}.ra-bar .ra-primary:hover{background:#6d7b68}'
  + '.ra-bar .ra-nav{padding:9px 11px;font-size:15px}'
  + '.ra-bar input[type=range]{width:64px;accent-color:#7C8B77}'
  + '.ra-bar .ra-spd{font-size:12px;color:#726F66;min-width:30px;text-align:center}'
  + '.ra-bar .ra-mode{font-size:11px;color:#9a968c;min-width:40px;text-align:center}'
  + '.ra-active{background:#FBF3DD!important;box-shadow:0 0 0 4px #FBF3DD;border-radius:6px;transition:background .2s}'
  + '@media print{.ra-bar{display:none}}'
  // 05/09/2026, הכרעת אסף (פס + צילום-מסך 20:02): פס-ההקראה מכסה את הכפתורים בטלפון - מוסתר עד 640px; במחשב נשאר. מהדורת-הרדיו של הבריף אינה תלויה בו.
  + '@media (max-width:640px){.ra-bar{display:none}}';
  document.head.appendChild(css);
  }

  var root = document.querySelector('.wrap') || document.querySelector('main') || document.body;
  var SEL = window.RA_SEL || 'h1,h2,h3,.lede,.kicker,.section-note,.meta,.stat,.qcard .tag,.qcard li,th,td,.item .name,.item p,.callout blockquote,.drop-line,p,li,blockquote,.sig,footer p';
  var nodes = Array.prototype.slice.call(root.querySelectorAll(SEL));
  nodes = nodes.filter(function (n) { return !nodes.some(function (o) { return o !== n && o.contains(n); }); })
               .filter(function (n) { return (n.innerText || '').trim().length > 1; });
  if (!nodes.length) {
    // 28/08/2026: תוכן שנכנס אחרי הטעינה - ממתינים לו במקום לצאת בשקט ולהשאיר עמוד בלי הקראה.
    window.__readAloud = false;
    if (!window.__readAloudWaiting) {
      window.__readAloudWaiting = true;
      var tries = 0;
      var iv = setInterval(function () {
        var r = document.querySelector('.wrap') || document.querySelector('main') || document.body;
        var found = r ? Array.prototype.slice.call(r.querySelectorAll(SEL))
              .filter(function (n) { return (n.innerText || '').trim().length > 1; }) : [];
        if (found.length) { clearInterval(iv); window.__readAloudWaiting = false; boot(); }
        else if (++tries > 1800) clearInterval(iv);   // ~15 דקות ואז מרפים
      }, 500);
    }
    return;
  }

  // ── split a block into single-language runs (he | en); neutral chars stick to the current run ──
  function classOf(ch) {
    if (/[֐-׿]/.test(ch)) return 'he';
    if (/[A-Za-z]/.test(ch)) return 'en';
    return null;
  }
  function splitRuns(text) {
    var out = [], buf = '', cur = null;
    for (var k = 0; k < text.length; k++) {
      var ch = text[k], c = classOf(ch);
      if (c === null) { buf += ch; continue; }
      if (cur === null) { cur = c; buf += ch; continue; }
      if (c === cur) { buf += ch; continue; }
      out.push({ t: buf, lang: cur }); buf = ch; cur = c;
    }
    if (buf.length) out.push({ t: buf, lang: cur || 'he' });
    var merged = [];
    out.forEach(function (r) {
      var letters = (r.t.match(/[A-Za-z֐-׿]/g) || []).length;
      if (merged.length && letters < 2) { merged[merged.length - 1].t += r.t; }
      else merged.push(r);
    });
    return merged.filter(function (r) { return r.t.trim().length; });
  }
  function textOf(n) { return (n.innerText || '').trim(); }

  // ── synth one run → Blob URL (cached in-page). text/plain avoids CORS preflight. ──
  var urlCache = {};
  function synthRun(run) {
    var key = run.lang + '|' + run.t;
    if (urlCache[key]) return Promise.resolve(urlCache[key]);
    return fetch(TTS, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify({ text: run.t }) })
      .then(function (r) { if (!r.ok) throw new Error('tts ' + r.status); return r.blob(); })
      .then(function (b) { var u = URL.createObjectURL(b); urlCache[key] = u; return u; });
  }
  var blockUrls = {};
  function synthBlock(idx) {
    if (idx < 0 || idx >= nodes.length) return Promise.resolve(null);
    if (blockUrls[idx]) return blockUrls[idx];
    blockUrls[idx] = Promise.all(splitRuns(textOf(nodes[idx])).map(synthRun));
    return blockUrls[idx];
  }

  // ── playback state: i = current block, j = current run within block. Both persist across pause. ──
  var i = 0, j = 0, playing = false, rate = 1.5, neural = true, curUrls = null, resumeMidRun = false;
  var audio = new Audio();
  var synthAPI = window.speechSynthesis, heVoice = null;
  function pickHe() { if (!synthAPI) return; var vs = synthAPI.getVoices() || [];
    heVoice = vs.filter(function (v) { return (v.lang || '').toLowerCase().indexOf('he') === 0; })[0] || null; }
  if (synthAPI) { pickHe(); if (synthAPI.onvoiceschanged !== undefined) synthAPI.onvoiceschanged = pickHe; }

  function highlight(idx) { nodes.forEach(function (n) { n.classList.remove('ra-active'); });
    if (idx >= 0 && idx < nodes.length) { nodes[idx].classList.add('ra-active'); nodes[idx].scrollIntoView({ block: 'center', behavior: 'smooth' }); } }

  // play current block from run j (neural path); lookahead next block
  function playFrom(idx, fromRun) {
    i = Math.max(0, Math.min(nodes.length - 1, idx)); j = fromRun || 0; curUrls = null;
    highlight(i); updNav();
    synthBlock(i).then(function (urls) {
      if (!playing || i !== this.want) return;
      synthBlock(i + 1);
      curUrls = urls;
      if (!urls || !urls.length) { if (playing) playFrom(i + 1, 0); return; }
      playRun();
    }.bind({ want: i })).catch(function () { neural = false; updMode(); fallbackFrom(i); });
  }
  function playRun() {
    if (!playing) return;
    if (!curUrls || j >= curUrls.length) { playFrom(i + 1, 0); return; }
    audio.src = curUrls[j]; audio.playbackRate = rate;
    audio.play().catch(function () {});
  }
  audio.onended = function () { if (!playing) return; j++; playRun(); };

  // browser-voice fallback (block granularity)
  function fallbackFrom(idx) {
    i = Math.max(0, Math.min(nodes.length - 1, idx)); highlight(i); updNav();
    if (!synthAPI) { playing = false; upd(); return; }
    var u = new SpeechSynthesisUtterance(textOf(nodes[i]));
    if (heVoice) { u.voice = heVoice; u.lang = heVoice.lang; } u.rate = rate;
    u.onend = function () { if (playing) fallbackFrom(i + 1); };
    synthAPI.speak(u);
  }

  function play() {
    playing = true; upd();
    if (resumeMidRun && audio.src && audio.paused) { resumeMidRun = false; audio.play().catch(function () {}); return; }
    if (!neural) { fallbackFrom(i); return; }
    playFrom(i, j);
  }
  function pause() {
    playing = false; upd();
    if (audio.src && !audio.paused) { audio.pause(); resumeMidRun = true; }
    if (synthAPI && synthAPI.speaking) synthAPI.pause();
  }
  function stepTo(idx) { // jump a block, keep play/pause state; used by ⏮ ⏭
    resumeMidRun = false; audio.pause(); if (synthAPI) synthAPI.cancel();
    i = Math.max(0, Math.min(nodes.length - 1, idx)); j = 0; curUrls = null;
    if (playing) { neural ? playFrom(i, 0) : fallbackFrom(i); }
    else { synthBlock(i); highlight(i); updNav(); }
  }
  function restart() { stepTo(0); }

  var bar = document.createElement('div'); bar.className = 'ra-bar';
  var bPlay = document.createElement('button'); bPlay.className = 'ra-primary';
  var bPrev = document.createElement('button'); bPrev.className = 'ra-nav'; bPrev.textContent = '⏮'; bPrev.title = 'החלק הקודם';
  var bNext = document.createElement('button'); bNext.className = 'ra-nav'; bNext.textContent = '⏭'; bNext.title = 'החלק הבא';
  var bTop = document.createElement('button'); bTop.className = 'ra-nav'; bTop.textContent = '↺'; bTop.title = 'מהתחלה';
  var spd = document.createElement('input'); spd.type = 'range'; spd.min = '1'; spd.max = '2'; spd.step = '0.1'; spd.value = '1.5';
  var spdLbl = document.createElement('span'); spdLbl.className = 'ra-spd'; spdLbl.textContent = '1.5x';
  var mode = document.createElement('span'); mode.className = 'ra-mode';
  function updMode() { mode.textContent = neural ? 'נוירוני' : 'מערכת'; }
  function upd() { bPlay.textContent = playing ? '⏸ השהה' : '🔊 הקרא לי'; }
  function updNav() { bPrev.disabled = (i <= 0); bNext.disabled = (i >= nodes.length - 1); }
  upd(); updMode(); updNav();
  bPlay.onclick = function () { playing ? pause() : play(); };
  bPrev.onclick = function () { stepTo(i - 1); };
  bNext.onclick = function () { stepTo(i + 1); };
  bTop.onclick = restart;
  spd.oninput = function () { rate = parseFloat(spd.value); spdLbl.textContent = rate.toFixed(1) + 'x'; audio.playbackRate = rate; };
  [bPlay, bPrev, bNext, bTop, spd, spdLbl, mode].forEach(function (el) { bar.appendChild(el); });
  document.body.appendChild(bar);
  window.addEventListener('beforeunload', function () { audio.pause(); if (synthAPI) synthAPI.cancel(); });
})();
