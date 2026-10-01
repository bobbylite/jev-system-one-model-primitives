(function () {
const $ = (s) => document.querySelector(s);
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const withCode = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>");
let config, current, threshold, history = [];

function countUp(el, to, ms = 1100, fmt = (v) => v.toFixed(2)) {
  const t0 = performance.now();
  const tick = (t) => {
    const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 4);
    el.textContent = fmt(to * e);
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

const priorityOf = (r) => {
  const u = r.urgency / r.urgency_max;
  const v = config.urgency_weight * u + config.anger_weight * r.angry;
  const [p1, p2] = config.priority_cuts;
  return { v, level: v >= p1 ? "P1" : v >= p2 ? "P2" : "P3", u };
};
const label = (id) => config.queues.find((q) => q.id === id).label;

/* decision depends on the threshold slider; no new inference */
function decide() {
  const r = current, auto = r.confidence >= threshold, p = priorityOf(r);
  const dest = auto ? label(r.choice) : "Human triage";
  const tone = auto ? "yes" : "mid";
  $("#dest").textContent = dest;
  $("#dest").className = "label " + tone;
  $("#why").textContent = auto
    ? `Confidence ${r.confidence.toFixed(2)} ≥ ${threshold.toFixed(2)}: routed automatically.`
    : `Confidence ${r.confidence.toFixed(2)} < ${threshold.toFixed(2)}: Jev leaned “${label(r.choice)}”, but a human should look first.`;
  $("#thr-val").textContent = threshold.toFixed(2);
  document.querySelectorAll(".opt").forEach((el) => el.classList.toggle("won", auto && el.dataset.id === r.choice));
}

function render(r) {
  current = r; threshold = config.confidence_at;
  const p = priorityOf(r), pl = p.level, ptone = pl === "P1" ? "no" : pl === "P2" ? "mid" : "yes";
  $("#stage").innerHTML = `
  <div class="panel reveal">
    <div class="verdict-top">
      <div style="flex:1;min-width:260px">
        <div class="eyebrow">Ticket</div>
        <div class="quote">“${esc(r.message)}”</div>
        <div class="eyebrow" style="margin-top:28px">Routed to</div>
        <div class="label" id="dest">–</div>
        <div class="meta" id="why" style="margin-top:10px"></div>
      </div>
      <div class="big-score">
        <div class="eyebrow">Priority</div>
        <div class="n tag ${ptone}" style="font-size:56px;letter-spacing:-.04em">${pl}</div>
        <div class="meta mono">${r.latency_ms} ms · 1 request · 3 questions</div>
      </div>
    </div>
    <div class="thr">
      <div class="eyebrow" style="margin:32px 0 12px">Auto-route threshold <span class="mono" id="thr-val" style="color:var(--ink);margin-left:8px"></span></div>
      <input type="range" id="thr" min="0" max="1" step="0.01" value="${threshold}">
      <div class="meta">Drag it. The decision flips instantly because confidence is already in hand. Jev isn't called again.</div>
    </div>
  </div>

  <div class="section-head reveal" style="animation-delay:.15s"><h2>The race</h2><span class="eyebrow">Choice · confidence <span class="mono" style="color:var(--ink)" id="conf">0.00</span></span></div>
  <div class="panel reveal" style="animation-delay:.2s">
    <div class="race">
      ${r.options.map((o, i) => `
        <div class="opt" data-id="${o.id}" style="transition-delay:${i * 40}ms">
          <div class="opt-head"><span class="opt-name">${esc(o.label)}</span><b class="mono" data-to="${o.probability}">0%</b></div>
          <div class="bar"><i data-w="${(o.probability * 100).toFixed(1)}%"></i></div>
          <div class="opt-desc">${esc(o.description)}</div>
        </div>`).join("")}
    </div>
  </div>

  <div class="section-head reveal" style="animation-delay:.3s"><h2>Fan-out</h2><span class="eyebrow">Same request · independent questions</span></div>
  <div class="signals">
    <div class="sig reveal" style="animation-delay:.35s">
      <div class="sig-top"><span class="eyebrow">Noul · angry</span><span class="p" data-to="${r.angry}">0.00</span></div>
      <div class="q">${withCode(config.questions.angry)}</div>
      <div class="bar"><i data-w="${(r.angry * 100).toFixed(1)}%"></i></div>
    </div>
    <div class="sig reveal" style="animation-delay:.43s">
      <div class="sig-top"><span class="eyebrow">Score · urgency</span><span class="p" data-to="${r.urgency}">0.00</span></div>
      <div class="q">${withCode(config.questions.urgency)}</div>
      <div class="bar"><i data-w="${(r.urgency / r.urgency_max * 100).toFixed(1)}%"></i></div>
      <div class="crit"><div class="t"><b>0</b>${esc(config.urgency_legend[0])}</div><div class="f"><b>${r.urgency_max}</b>${esc(config.urgency_legend[r.urgency_max])}</div></div>
    </div>
  </div>
  <div class="panel reveal formula" style="animation-delay:.5s;margin-top:12px">
    urgency = <span>${r.urgency.toFixed(2)}</span> ÷ ${r.urgency_max} = <span>${p.u.toFixed(2)}</span><br>
    priority = ${config.urgency_weight} × <span>${p.u.toFixed(2)}</span> + ${config.anger_weight} × <span>${r.angry.toFixed(2)}</span> = <span>${p.v.toFixed(2)}</span><br>
    ≥ ${config.priority_cuts[0]} → P1 · ≥ ${config.priority_cuts[1]} → P2 · otherwise P3
  </div>`;
  $("#thr").oninput = (e) => { threshold = +e.target.value; decide(); };
  decide();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    countUp($("#conf"), r.confidence, 1100);
    document.querySelectorAll(".opt b").forEach((el) => countUp(el, +el.dataset.to * 100, 1100, (v) => v.toFixed(0) + "%"));
    document.querySelectorAll(".p[data-to]").forEach((el) => countUp(el, +el.dataset.to, 1100));
    document.querySelectorAll(".stage-bars, .bar > i").forEach((el, i) => setTimeout(() => (el.style.width = el.dataset.w), 200 + i * 60));
  }));
}

function renderHistory() {
  if (history.length < 2) { $("#history-wrap").innerHTML = ""; return; }
  $("#history-wrap").innerHTML = `
    <div class="section-head"><h2>Inbox</h2><span class="eyebrow">${history.length} routed · click to revisit</span></div>
    <div class="history">${history.map((r, i) => { const p = priorityOf(r); return `
      <div class="h-row" data-i="${i}"><span class="clip">${esc(r.message)}</span><span class="tag ${r.confidence >= config.confidence_at ? "yes" : "mid"}">${r.confidence >= config.confidence_at ? label(r.choice).toUpperCase() : "HUMAN TRIAGE"}</span><span class="mono" style="text-align:right">${p.level}</span></div>`; }).join("")}
    </div>`;
  document.querySelectorAll(".h-row").forEach((el) => el.onclick = () => { render(history[el.dataset.i]); scrollTo({ top: 300, behavior: "smooth" }); });
}

async function route(message) {
  message = message.trim();
  if (!message) return;
  $("#go").disabled = true;
  $("#stage").innerHTML = `<div class="skel"></div><div class="status">Routing: one Choice, one Noul, one Score, in parallel…</div>`;
  try {
    const res = await fetch("/api/chaos/route", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }) });
    if (!res.ok) throw new Error((await res.json()).detail || res.statusText);
    const r = await res.json();
    history = [r, ...history.filter((h) => h.message !== r.message)];
    render(r); renderHistory();
  } catch (e) {
    $("#stage").innerHTML = `<div class="error reveal">${esc(String(e.message || e))}</div>`;
  } finally { $("#go").disabled = false; }
}

window.views = window.views || {};
window.views.chaos = { mount(el) {
  el.innerHTML = `
  <div class="eyebrow">Choice · pick one from a defined set</div>
  <h1>Route the <em>chaos.</em></h1>
  <p class="lede">Paste an unhinged customer message. One Choice picks the support queue and returns a probability for every queue. A Noul and a Score ask about anger and urgency in the same request, and code sets the priority.</p>
  <form id="form" autocomplete="off">
    <input id="msg" placeholder="Describe your problem… (my toaster is haunted)" maxlength="1000" autofocus>
    <button class="go" id="go">Route it</button>
  </form>
  <div class="chips" id="chips"></div>
  <div id="stage"></div>
  <div id="history-wrap"></div>`;
  $("#form").onsubmit = (e) => { e.preventDefault(); route($("#msg").value); };
  fetch("/api/chaos/config").then((r) => r.json()).then((c) => {
    config = c;
    $("#chips").innerHTML = c.examples.map((f) => `<button type="button" class="chip" title="${esc(f)}">${esc(f.length > 44 ? f.slice(0, 42) + "…" : f)}</button>`).join("");
    document.querySelectorAll(".chip").forEach((el, i) => el.onclick = () => { $("#msg").value = c.examples[i]; route(c.examples[i]); });
    if (history.length) { render(history[0]); renderHistory(); }
  });
} };
})();
