(function () {
const $ = (s) => document.querySelector(s);
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const withCode = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>");
const NAMES = { devotion: "Identity", jargon: "Insider language", rituals: "Rituals", leader: "Revered leader", exit_cost: "Cost of leaving", evangelism: "Recruiting" };
const TONE = ["var(--yes)", "var(--yes)", "var(--mid)", "var(--no)", "var(--no)"];
let config, current, weights, history = [];

function countUp(el, to, ms = 1200, fmt = (v) => v.toFixed(2)) {
  const t0 = performance.now();
  const tick = (t) => {
    const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 4);
    el.textContent = fmt(to * e);
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function composite(r) {
  let num = 0, den = 0;
  for (const d of r.dimensions) { num += weights[d.id] * (d.score / d.max_level); den += weights[d.id]; }
  return den ? num / den : 0;
}
const tierOf = (v) => config.tiers.find((t) => v < t.max).label;
const tone = (v) => (v < 0.4 ? "yes" : v < 0.65 ? "mid" : "no");

/* ---- radar ---- */
function radar(r) {
  const n = r.dimensions.length, R = 120, C = 170;
  const pt = (i, v) => { const a = -Math.PI / 2 + (i / n) * Math.PI * 2; return [C + Math.cos(a) * R * v, C + Math.sin(a) * R * v]; };
  const ring = (v) => r.dimensions.map((_, i) => pt(i, v).join(",")).join(" ");
  const axes = r.dimensions.map((d, i) => {
    const [x, y] = pt(i, 1), [lx, ly] = pt(i, 1.2);
    const anchor = lx < C - 8 ? "end" : lx > C + 8 ? "start" : "middle";
    return `<line x1="${C}" y1="${C}" x2="${x}" y2="${y}" stroke="var(--line)"/>
            <text x="${lx}" y="${ly + 4}" text-anchor="${anchor}" fill="var(--ink-2)" font-size="11" font-family="Inter">${NAMES[d.id]}</text>`;
  }).join("");
  return `<svg viewBox="0 0 340 340" class="radar">
    ${[.25, .5, .75, 1].map((v) => `<polygon points="${ring(v)}" fill="none" stroke="var(--line)"/>`).join("")}
    ${axes}
    <polygon id="rpoly" points="${ring(0)}" fill="var(--ink)" fill-opacity=".12" stroke="var(--ink)" stroke-width="1.5" stroke-linejoin="round"/>
    ${r.dimensions.map((_, i) => `<circle class="rdot" cx="${C}" cy="${C}" r="4" fill="var(--bg)" stroke="var(--ink)" stroke-width="1.5"/>`).join("")}
  </svg>`;
}
function animateRadar(r) {
  const n = r.dimensions.length, R = 120, C = 170, t0 = performance.now();
  const dots = document.querySelectorAll(".rdot"), poly = $("#rpoly");
  const tick = (t) => {
    const k = Math.min(1, (t - t0) / 1300), e = 1 - Math.pow(1 - k, 4);
    const pts = r.dimensions.map((d, i) => {
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2, v = (d.score / d.max_level) * e;
      return [C + Math.cos(a) * R * v, C + Math.sin(a) * R * v];
    });
    poly.setAttribute("points", pts.map((p) => p.join(",")).join(" "));
    pts.forEach((p, i) => { dots[i].setAttribute("cx", p[0]); dots[i].setAttribute("cy", p[1]); });
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/* ---- composite readout (re-run when weights change; no new inference) ---- */
function updateComposite() {
  const v = composite(current), h = current.overall.score / current.overall.max_level;
  $("#tier").textContent = tierOf(v);
  $("#tier").className = "label " + tone(v);
  $("#needle").style.left = v * 100 + "%";
  $("#needle").dataset.v = (v * 100).toFixed(0);
  $("#ghost").style.left = h * 100 + "%";
  countUp($("#cscore"), v * 100, 500, (x) => x.toFixed(0));
  $("#verdict-note").textContent = `Jev's own holistic answer: “${current.overall.levels[Math.round(current.overall.score)].description}” (${(h * 100).toFixed(0)}).`;
}

function render(r) {
  current = r;
  weights = { ...config.weights };
  const span = (r.overall.max_level + 1);
  $("#stage").innerHTML = `
  <div class="panel reveal">
    <div class="verdict-top">
      <div>
        <div class="eyebrow">Verdict · weighted composite</div>
        <div class="food">${esc(r.group)}</div>
        <div class="label" id="tier">–</div>
      </div>
      <div class="big-score">
        <div class="eyebrow">Cult index</div>
        <div class="n"><span id="cscore">0</span><span style="color:var(--ink-3);font-size:24px"> /100</span></div>
        <div class="meta mono">${r.latency_ms} ms · 1 request · 7 Scores</div>
      </div>
    </div>
    <div class="track">
      ${config.tiers.map((t, i) => `<div class="zone ${["yes", "yes", "mid", "no", "no"][i]}" style="flex:1;animation-delay:${i * 100}ms"></div>`).join("")}
      <div class="marker" id="needle" data-v="0"></div>
      <div class="ghost" id="ghost" title="Jev's holistic answer"></div>
    </div>
    <div class="track-labels mono">${config.tiers.map((t) => `<span>${t.label}</span>`).join("")}</div>
    <div class="meta" id="verdict-note" style="margin-top:24px"></div>
  </div>

  <div class="section-head reveal" style="animation-delay:.15s"><h2>Six dimensions</h2><span class="eyebrow">6 Score judgments · 0 → max level</span></div>
  <div class="radar-grid reveal" style="animation-delay:.2s">
    <div class="panel radar-wrap">${radar(r)}</div>
    <div class="panel">
      <div class="eyebrow" style="margin-bottom:6px">Your weights</div>
      <p class="meta" style="margin:0 0 20px">Drag to re-weigh. The composite recomputes instantly from the stored scores; Jev isn't called again.</p>
      ${r.dimensions.map((d) => `
        <label class="wt"><span>${NAMES[d.id]}</span>
          <input type="range" min="0" max="2" step="0.1" value="${weights[d.id]}" data-id="${d.id}"><b class="mono">${weights[d.id].toFixed(1)}</b></label>`).join("")}
    </div>
  </div>

  <div class="signals" style="margin-top:12px">
    ${r.dimensions.map((d, i) => card(d, i)).join("")}
  </div>

  <div class="section-head reveal" style="animation-delay:.6s"><h2>How the composite is built</h2><span class="eyebrow">Policy lives in cult.py</span></div>
  <div class="panel reveal formula" id="formula" style="animation-delay:.65s"></div>`;

  document.querySelectorAll(".wt input").forEach((el) => el.oninput = () => {
    weights[el.dataset.id] = +el.value;
    el.nextElementSibling.textContent = (+el.value).toFixed(1);
    updateComposite(); formula();
  });
  formula();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    updateComposite(); animateRadar(r);
    document.querySelectorAll(".lv i").forEach((el, i) => setTimeout(() => (el.style.width = el.dataset.w), 250 + (i % 14) * 50));
    document.querySelectorAll(".p[data-to]").forEach((el) => countUp(el, +el.dataset.to, 1200));
  }));
}

function formula() {
  const r = current, den = Object.values(weights).reduce((a, b) => a + b, 0);
  $("#formula").innerHTML =
    r.dimensions.map((d) => `${NAMES[d.id].padEnd(16, " ")} <span>${(d.score / d.max_level).toFixed(2)}</span> × w <span>${weights[d.id].toFixed(1)}</span>`).join("<br>").replace(/ /g, "&nbsp;") +
    `<br><br>index = Σ(score × w) ÷ Σ(w) = <span>${composite(r).toFixed(2)}</span> &nbsp;(Σw = ${den.toFixed(1)})<br>` +
    `each Score is normalized by (levels − 1) before weighting, so 3-step and 5-step scales combine fairly.`;
}

function card(d, i) {
  const top = d.levels.reduce((a, b) => (b.probability > a.probability ? b : a)).level;
  return `
  <div class="sig reveal" style="animation-delay:${.25 + i * .08}s">
    <div class="sig-top"><span class="eyebrow">${NAMES[d.id]}</span>
      <span class="p" data-to="${d.score}">0.00</span></div>
    <div class="q">${withCode(d.instructions)}</div>
    <div class="levels">${d.levels.map((l) => `
      <div class="lv ${l.level === top ? "top" : ""}">
        <div class="lv-head"><span class="mono">${l.level}</span><span class="lv-desc">${esc(l.description)}</span><b class="mono">${(l.probability * 100).toFixed(0)}%</b></div>
        <div class="bar"><i data-w="${(l.probability * 100).toFixed(1)}%"></i></div>
      </div>`).join("")}</div>
    <div class="meta mono" style="margin-top:14px">score ${d.score.toFixed(2)} / ${d.max_level} · confidence ${d.confidence.toFixed(2)}</div>
  </div>`;
}

function renderHistory() {
  if (history.length < 2) { $("#history-wrap").innerHTML = ""; return; }
  $("#history-wrap").innerHTML = `
    <div class="section-head"><h2>Leaderboard</h2><span class="eyebrow">${history.length} groups · most cult-like first</span></div>
    <div class="history">${history.map((r, i) => { const v = composite0(r); return `
      <div class="h-row" data-i="${i}"><span>${esc(r.group)}</span><span class="tag ${tone(v)}">${tierOf(v).toUpperCase()}</span><span class="mono" style="text-align:right">${(v * 100).toFixed(0)}</span></div>`; }).join("")}
    </div>`;
  document.querySelectorAll(".h-row").forEach((el) => el.onclick = () => { render(history[el.dataset.i]); scrollTo({ top: 300, behavior: "smooth" }); });
}
function composite0(r) {
  const w = config.weights; let n = 0, d = 0;
  for (const x of r.dimensions) { n += w[x.id] * x.score / x.max_level; d += w[x.id]; }
  return n / d;
}

async function score(group) {
  group = group.trim();
  if (!group) return;
  $("#go").disabled = true;
  $("#stage").innerHTML = `<div class="skel"></div><div class="status">Asking Jev seven scale questions about “${esc(group)}”…</div>`;
  try {
    const res = await fetch("/api/cult/score", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ group }) });
    if (!res.ok) throw new Error((await res.json()).detail || res.statusText);
    const r = await res.json();
    history = [r, ...history.filter((h) => h.group.toLowerCase() !== r.group.toLowerCase())].sort((a, b) => composite0(b) - composite0(a));
    render(r); renderHistory();
  } catch (e) {
    $("#stage").innerHTML = `<div class="error reveal">${esc(String(e.message || e))}</div>`;
  } finally { $("#go").disabled = false; }
}

window.views = window.views || {};
window.views.cult = { mount(el) {
  el.innerHTML = `
  <div class="eyebrow">Score · graded judgments on ordered levels</div>
  <h1>How much of a <em>cult</em> is it?</h1>
  <p class="lede">Yes/no can't capture this one. Jev places each group on six ordered scales and returns a probability for every level, not just one answer. Code weighs them into a single index, and you can re-weigh it live.</p>
  <form id="form" autocomplete="off">
    <input id="group" placeholder="Type a group: Crossfit, Swifties, your office…" maxlength="80" autofocus>
    <button class="go" id="go">Measure</button>
  </form>
  <div class="chips" id="chips"></div>
  <div id="stage"></div>
  <div id="history-wrap"></div>`;
  $("#form").onsubmit = (e) => { e.preventDefault(); score($("#group").value); };
  fetch("/api/cult/config").then((r) => r.json()).then((c) => {
    config = c;
    $("#chips").innerHTML = c.examples.map((f) => `<button type="button" class="chip">${esc(f)}</button>`).join("");
    document.querySelectorAll(".chip").forEach((el) => el.onclick = () => { $("#group").value = el.textContent; score(el.textContent); });
    if (history.length) { render(history[0]); renderHistory(); }
  });
} };
})();
