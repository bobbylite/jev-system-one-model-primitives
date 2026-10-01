(function () {
const $ = (s) => document.querySelector(s);
const pct = (v) => (v * 100).toFixed(0) + "%";
const NAMES = { bread: "Has bread", filling: "Has a filling", two_pieces: "Two or more pieces", handheld: "Eaten by hand", sandwich_by_name: "Called a sandwich" };
let config, history = [];

const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const withCode = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>");
const cls = (label) => label === "SANDWICH" ? "yes" : label === "NOT A SANDWICH" ? "no" : "mid";
const pretty = (label) => ({ "SANDWICH": "A sandwich.", "NOT A SANDWICH": "Not a sandwich.", "CONTESTED": "Contested." }[label]);

function countUp(el, to, ms = 1200, fmt = (v) => v.toFixed(2)) {
  const t0 = performance.now();
  const tick = (t) => {
    const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 4);
    el.textContent = fmt(to * e);
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function render(r) {
  const P = config.policy, c = cls(r.label);
  const sig = Object.fromEntries(r.signals.map((s) => [s.id, s.probability]));
  const zones = [
    ["no", P.not_sandwich_at], ["mid", P.sandwich_at - P.not_sandwich_at], ["yes", 1 - P.sandwich_at],
  ];
  const chain = ["bread", "filling", "handheld"].map((k) => `<span>${sig[k].toFixed(2)}</span>`).join(" × ");

  $("#stage").innerHTML = `
  <div class="panel reveal">
    <div class="verdict-top">
      <div>
        <div class="eyebrow">Verdict</div>
        <div class="food">${esc(r.food)}</div>
        <div class="label ${c}">${pretty(r.label)}</div>
      </div>
      <div class="big-score">
        <div class="eyebrow">Composite score</div>
        <div class="n" id="bigscore">0.00</div>
        <div class="meta mono">${r.latency_ms} ms · 1 request · 5 questions</div>
      </div>
    </div>
    <div class="track">
      ${zones.map(([z, w], i) => `<div class="zone ${z}" style="flex:${w};animation-delay:${i * 120}ms"></div>`).join("")}
      <div class="marker" id="marker" data-v="${r.score.toFixed(2)}"></div>
    </div>
    <div class="track-labels mono"><span>0 · not</span><span>${P.not_sandwich_at}</span><span>${P.sandwich_at}</span><span>1 · sandwich</span></div>
  </div>

  <div class="section-head reveal" style="animation-delay:.15s"><h2>What Jev said</h2><span class="eyebrow">5 Noul judgments · P(yes)</span></div>
  <div class="signals">
    ${r.signals.map((s, i) => `
      <div class="sig reveal" style="animation-delay:${.2 + i * .09}s">
        <div class="sig-top"><span class="eyebrow">${s.id}</span><span class="p" data-to="${s.probability}">0.00</span></div>
        <div class="q">${withCode(s.instructions)}</div>
        <div class="bar"><i data-w="${s.probability}"></i></div>
        ${s.true_criterion ? `<div class="crit"><div class="t"><b>TRUE</b>${esc(s.true_criterion)}</div><div class="f"><b>FALSE</b>${esc(s.false_criterion)}</div></div>` : ""}
      </div>`).join("")}
  </div>

  <div class="section-head reveal" style="animation-delay:.5s"><h2>How code decided</h2><span class="eyebrow">Policy lives in sandwich.py</span></div>
  <div class="panel math reveal" style="animation-delay:.55s">
    <div class="row"><div class="name">Structural fit<small>bread × filling × handheld × pieces</small></div>
      <div class="bar"><i data-w="${r.structural}"></i></div><div class="v">${r.structural.toFixed(2)}</div></div>
    <div class="row"><div class="name">Pieces factor<small>max(two_pieces, 0.5)</small></div>
      <div class="bar"><i data-w="${r.pieces_factor}"></i></div><div class="v">${r.pieces_factor.toFixed(2)}</div></div>
    <div class="row"><div class="name">Common usage<small>sandwich_by_name</small></div>
      <div class="bar"><i data-w="${sig.sandwich_by_name}"></i></div><div class="v">${sig.sandwich_by_name.toFixed(2)}</div></div>
    <div class="formula">
      structural = ${chain} × <span>${r.pieces_factor.toFixed(2)}</span> = <span>${r.structural.toFixed(2)}</span><br>
      score = ${P.structural_weight} × <span>${r.structural.toFixed(2)}</span> + ${P.name_weight} × <span>${sig.sandwich_by_name.toFixed(2)}</span> = <span>${r.score.toFixed(2)}</span><br>
      ≥ ${P.sandwich_at} → sandwich · ≤ ${P.not_sandwich_at} → not · otherwise contested
    </div>
  </div>`;

  requestAnimationFrame(() => requestAnimationFrame(() => {
    $("#marker").style.left = `${r.score * 100}%`;
    countUp($("#bigscore"), r.score, 1400);
    document.querySelectorAll(".p").forEach((el) => countUp(el, +el.dataset.to, 1200));
    document.querySelectorAll(".bar > i").forEach((el, i) => setTimeout(() => (el.style.width = pct(el.dataset.w)), 250 + i * 70));
  }));
}

function renderHistory() {
  if (history.length < 2) { $("#history-wrap").innerHTML = ""; return; }
  $("#history-wrap").innerHTML = `
    <div class="section-head"><h2>Session</h2><span class="eyebrow">${history.length} classified · click to revisit</span></div>
    <div class="history">${history.map((r, i) => `
      <div class="h-row" data-i="${i}"><span>${esc(r.food)}</span><span class="tag ${cls(r.label)}">${r.label}</span><span class="mono" style="text-align:right">${r.score.toFixed(2)}</span></div>`).join("")}
    </div>`;
  document.querySelectorAll(".h-row").forEach((el) => el.onclick = () => { render(history[el.dataset.i]); scrollTo({ top: 300, behavior: "smooth" }); });
}

async function classify(food) {
  food = food.trim();
  if (!food) return;
  $("#go").disabled = true;
  $("#stage").innerHTML = `<div class="skel"></div><div class="status">Asking Jev five questions about “${esc(food)}”…</div>`;
  try {
    const res = await fetch("/api/classify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ food }) });
    if (!res.ok) throw new Error((await res.json()).detail || res.statusText);
    const r = await res.json();
    history = [r, ...history.filter((h) => h.food.toLowerCase() !== r.food.toLowerCase())];
    render(r); renderHistory();
  } catch (e) {
    $("#stage").innerHTML = `<div class="error reveal">${esc(String(e.message || e))}</div>`;
  } finally { $("#go").disabled = false; }
}


window.views = window.views || {};
window.views.sandwich = { mount(el) {
  el.innerHTML = `
  <div class="eyebrow">Noul · a demonstration of typed judgments</div>
  <h1>Is it a <em>sandwich?</em></h1>
  <p class="lede">Jev doesn't write an essay about it. It answers five narrow yes/no questions with probabilities, and plain code turns them into a verdict. Everything it used to decide is shown below.</p>
  <form id="form" autocomplete="off">
    <input id="food" placeholder="Type a food: gyro, calzone, sushi burrito…" maxlength="80" autofocus>
    <button class="go" id="go">Classify</button>
  </form>
  <div class="chips" id="chips"></div>
  <div id="stage"></div>
  <div id="history-wrap"></div>
`;
$("#form").onsubmit = (e) => { e.preventDefault(); classify($("#food").value); };

fetch("/api/config").then((r) => r.json()).then((c) => {
  config = c;
  $("#chips").innerHTML = c.examples.map((f) => `<button type="button" class="chip">${esc(f)}</button>`).join("");
  document.querySelectorAll(".chip").forEach((el) => el.onclick = () => { $("#food").value = el.textContent; classify(el.textContent); });
});
} };
})();
