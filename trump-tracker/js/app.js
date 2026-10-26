// UI: state, rendering, what-if editing and sync wiring.
(function (TT) {
  const KEYS = { synced: 'tt.synced.v1', overrides: 'tt.overrides.v1', theme: 'tt.theme' };
  const AUTO_SYNC_AFTER_MS = 6 * 60 * 60 * 1000;
  const TABS = [
    ['dashboard', 'Dashboard'], ['housing', 'Housing'], ['crash', 'Crash watch'],
    ['costs', 'Cost of living'], ['budget', 'Household budget'], ['promises', 'Promises & links'],
  ];

  // localStorage can throw (private mode, blocked storage); the app must still run.
  const store = {
    get(k) { try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : null; } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };

  const snapshotData = TT.parseResponses(window.TRACKER_SNAPSHOT.responses);
  const state = {
    base: null,
    overrides: store.get(KEYS.overrides) || {},
    syncing: false,
    syncError: null,
    tab: 'dashboard',
    cost: { q: '', group: 'all', sort: 'sheet' },
  };

  // Live values win; anything the live pull is missing falls back to the snapshot.
  function withSnapshot(live, source) {
    return {
      values: Object.assign({}, snapshotData.values, live.values),
      updated: live.updated || snapshotData.updated,
      promises: live.promises,
      econ: live.econ.length ? live.econ : snapshotData.econ,
      sheetScores: live.sheetScores,
      missing: live.missing,
      source,
    };
  }

  function loadBase() {
    const saved = store.get(KEYS.synced);
    if (saved && saved.responses) {
      try { return withSnapshot(TT.parseResponses(saved.responses), { kind: 'synced', fetchedAt: saved.fetchedAt }); } catch (e) { /* fall through */ }
    }
    return Object.assign({}, snapshotData, { source: { kind: 'snapshot', fetchedAt: window.TRACKER_SNAPSHOT.fetchedAt } });
  }

  const overrideCount = () => Object.keys(state.overrides).length;
  const effectiveValues = () => Object.assign({}, state.base.values, state.overrides);

  // ---------- formatting ----------
  const nf = (min, max) => new Intl.NumberFormat('en-US', { minimumFractionDigits: min, maximumFractionDigits: max });
  const N0 = nf(0, 0), N1 = nf(1, 1), N2 = nf(2, 2), N3 = nf(3, 3);
  const FMT = {
    usd0: (v) => (v < 0 ? '-$' : '$') + N0.format(Math.abs(v)),
    usd2: (v) => (v < 0 ? '-$' : '$') + N2.format(Math.abs(v)),
    price: (v) => (v < 0 ? '-$' : '$') + (Math.abs(v) < 1 ? N3 : N2).format(Math.abs(v)),
    pct0: (v) => N0.format(v * 100) + '%',
    pct1: (v) => N1.format(v * 100) + '%',
    pct2: (v) => N2.format(v * 100) + '%',
    num0: (v) => N0.format(v),
    num1: (v) => N1.format(v),
    int: (v) => N0.format(v),
    index: (v) => N1.format(v),
    usdB: (v) => '$' + (Math.abs(v) < 100 ? N2 : N0).format(v) + 'B',
    text: (v) => (v == null || v === '' ? 'None' : String(v)),
  };
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  function fmt(name, v) {
    if (name === 'text') return FMT.text(v);
    return isNum(v) ? FMT[name](v) : '—';
  }
  const signed = (s, v) => (v > 0 ? '+' : '') + s;
  function fmtDiff(name, d) {
    if (!isNum(d)) return '—';
    if (name.startsWith('pct')) return signed(N2.format(d * 100), d) + ' pts';
    if (name === 'usd0' || name === 'usd2' || name === 'price' || name === 'usdB') return (d > 0 ? '+' : '') + fmt(name, d);
    return signed(name === 'int' ? N0.format(d) : N1.format(d), d);
  }
  const fmtPct = (p) => (isNum(p) ? signed(N1.format(p * 100) + '%', p) : '—');
  const fmtScore = (v) => (isNum(v) ? N1.format(v) : '—');
  const trimNum = (v, dp) => String(Number(v.toFixed(dp)));
  function fmtThreshold(name, t) {
    if (name.startsWith('pct')) return trimNum(t * 100, 2) + '%';
    if (name === 'usdB') return '$' + N0.format(t) + 'B';
    if (name === 'int' && Math.abs(t) >= 1e6) return trimNum(t / 1e6, 2) + 'M';
    if (name === 'int' && Math.abs(t) >= 1e3) return trimNum(t / 1e3, 1) + 'K';
    return trimNum(t, 3);
  }

  // What the user types into an editable cell, and how it is read back.
  const editText = (name, v) => (!isNum(v) ? '' : name.startsWith('pct') ? trimNum(v * 100, 4) : trimNum(v, 6));
  function parseEdit(name, text) {
    const cleaned = String(text).replace(/[$,%\s]/g, '').replace(/b$/i, '');
    if (cleaned === '' || !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(cleaned)) return NaN;
    const n = Number(cleaned);
    return name.startsWith('pct') ? n / 100 : n;
  }

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const link = (url, text, cls = '') => (url ? `<a class="${cls}" href="${esc(url)}" data-fid="a:${esc(url)}" target="_blank" rel="noopener noreferrer">${text}</a>` : '');
  const pill = (tier, extra = '') => `<span class="pill tone-${tier.tone}">${esc(tier.label)}${extra}</span>`;

  function relTime(iso) {
    const t = Date.parse(iso);
    if (!t) return 'unknown time';
    const mins = Math.round((Date.now() - t) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    if (mins < 48 * 60) return `${Math.round(mins / 60)} h ago`;
    return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // ---------- editable cells ----------
  function cell(key, name, label) {
    const v = effectiveValues()[key];
    const edited = Object.prototype.hasOwnProperty.call(state.overrides, key);
    const baseV = state.base.values[key];
    const title = edited ? `Your value. Source value: ${fmt(name, baseV)}` : 'Click to try a different value';
    return `<span class="cell${edited ? ' is-edited' : ''}"><input class="cell-input" data-key="${esc(key)}" data-fmt="${name}"
      value="${esc(fmt(name, v))}" inputmode="decimal" autocomplete="off" spellcheck="false"
      aria-label="${esc(label)}" title="${esc(title)}">${edited ? `<button class="cell-reset" data-reset="${esc(key)}" title="Restore source value (${esc(fmt(name, baseV))})" aria-label="Restore source value for ${esc(label)}">↺</button>` : ''}</span>`;
  }

  function setOverride(key, value) {
    const baseV = state.base.values[key];
    if (isNum(baseV) && Math.abs(value - baseV) <= Math.abs(baseV) * 1e-9) delete state.overrides[key];
    else state.overrides[key] = value;
    store.set(KEYS.overrides, state.overrides);
  }

  // ---------- SVG pieces ----------
  function gauge(score, tiers, size = 'md') {
    const max = 100, cx = 100, cy = 100, r = 80;
    const clamp = (v) => Math.max(0, Math.min(max, v));
    const pt = (v, rr = r) => {
      const a = Math.PI * (1 - clamp(v) / max);
      return [(cx + rr * Math.cos(a)).toFixed(2), (cy - rr * Math.sin(a)).toFixed(2)];
    };
    const arc = (a, b) => { const [x1, y1] = pt(a), [x2, y2] = pt(b); return `M${x1} ${y1} A${r} ${r} 0 0 1 ${x2} ${y2}`; };
    const asc = tiers.map(([min, , tone]) => [Math.max(0, min === -Infinity ? 0 : min), tone]).sort((a, b) => a[0] - b[0]);
    const segs = asc.map(([from, tone], i) => {
      const to = i + 1 < asc.length ? asc[i + 1][0] : max;
      return to > from ? `<path class="g-seg tone-${tone}" d="${arc(from, to)}"/>` : '';
    }).join('');
    const tone = TT.tierFor(tiers, score).tone;
    const [nx, ny] = pt(score, r - 22);
    const [mx, my] = pt(score);
    return `<svg class="gauge gauge-${size}" viewBox="0 0 200 112" role="img" aria-label="Score ${fmtScore(score)} out of 100">
      ${segs}
      ${isNum(score) ? `<path class="g-fill tone-${tone}" d="${arc(0, score)}"/>
      <line class="g-needle" x1="${cx}" y1="${cy}" x2="${nx}" y2="${ny}"/>
      <circle class="g-hub" cx="${cx}" cy="${cy}" r="6"/>
      <circle class="g-mark tone-${tone}" cx="${mx}" cy="${my}" r="8"/>` : ''}
      <text class="g-tick" x="20" y="111" text-anchor="middle">0</text>
      <text class="g-tick" x="180" y="111" text-anchor="middle">100</text>
    </svg>`;
  }

  function bar(fraction, tone) {
    const pct = Math.max(0, Math.min(1, isNum(fraction) ? fraction : 0)) * 100;
    return `<span class="bar"><span class="bar-fill tone-${tone}" style="width:${pct.toFixed(1)}%"></span></span>`;
  }

  function lineChart(points) {
    if (points.length < 2) return '<p class="muted">Not enough history to chart yet.</p>';
    const W = 640, H = 240, L = 44, R = 14, T = 14, B = 28;
    const t0 = points[0].t, t1 = points[points.length - 1].t;
    const vs = points.map((p) => p.v);
    const lo = Math.floor(Math.min(100, ...vs) / 10) * 10, hi = Math.ceil(Math.max(...vs) / 10) * 10;
    const x = (t) => L + (t - t0) / (t1 - t0) * (W - L - R);
    const y = (v) => T + (hi - v) / (hi - lo) * (H - T - B);
    const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ');
    const area = `${line} L${x(t1).toFixed(1)} ${y(lo)} L${x(t0).toFixed(1)} ${y(lo)} Z`;
    let grid = '';
    for (let v = lo; v <= hi; v += 10) {
      grid += `<line class="c-grid${v === 100 ? ' c-base' : ''}" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>
        <text class="c-label" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
    }
    const y0 = new Date(t0).getUTCFullYear(), y1 = new Date(t1).getUTCFullYear();
    for (let yr = y0 + 1; yr <= y1; yr++) {
      const tx = x(Date.UTC(yr, 0, 1));
      grid += `<line class="c-tick" x1="${tx}" x2="${tx}" y1="${H - B}" y2="${H - B + 5}"/><text class="c-label" x="${tx}" y="${H - 8}" text-anchor="middle">${yr}</text>`;
    }
    const dots = points.map((p) => `<circle class="c-dot" cx="${x(p.t).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="3.5"><title>${new Date(p.t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}: ${N2.format(p.v)}</title></circle>`).join('');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Household cost index from ${y0} to ${y1}">
      ${grid}<path class="c-area" d="${area}"/><path class="c-line" d="${line}"/>${dots}</svg>`;
  }

  // ---------- views ----------
  function whatIfNote(cur, base) {
    if (!overrideCount() || !isNum(cur) || !isNum(base) || Math.abs(cur - base) < 0.005) return '';
    const d = cur - base;
    return `<p class="whatif-note">What-if: ${d > 0 ? '+' : ''}${N1.format(d)} vs. source (${fmtScore(base)})</p>`;
  }

  function scoreCard(title, hint, part, basePart, tiers, id) {
    return `<article class="card score-card" id="${id}">
      <h3>${title}</h3>
      ${gauge(part.score, tiers)}
      <div class="score-num">${fmtScore(part.score)}</div>
      ${pill(part.tier)}
      <p class="hint">${hint}</p>
      ${whatIfNote(part.score, basePart.score)}
    </article>`;
  }

  function viewDashboard(res, base) {
    const h = res.health;
    const toneOf = { affordability: 'a', supply: 'b', crash: 'c' };
    const comp = h.parts.map((p) => `<span class="stack-seg seg-${toneOf[p.key]}" style="width:${Math.max(0, p.contrib).toFixed(2)}%" title="${esc(p.label)}: ${N1.format(p.contrib)} pts"></span>`).join('');
    const compLegend = h.parts.map((p) => `<li><span class="swatch seg-${toneOf[p.key]}"></span>${esc(p.label)} <b>${N1.format(p.value)}</b> × ${Math.round(p.weight * 100)}% = <b>${N1.format(p.contrib)}</b></li>`).join('');

    const supplyRows = res.supply.parts.map((p) => `<li>
        <div class="row-head"><span>${esc(p.label)} <span class="muted">(${Math.round(p.weight * 100)}%)</span></span><b>${N0.format(p.ratio * 100)}% of target</b></div>
        ${bar(p.ratio, p.ratio >= 0.9 ? 'good' : p.ratio >= 0.65 ? 'watch' : p.ratio >= 0.45 ? 'warn' : 'bad')}
        <div class="row-sub muted">${fmt('int', p.current)} of ${fmt('int', p.target)}</div></li>`).join('');
    const affRows = res.affordability.parts.map((p) => {
      const f = p.pts / p.max;
      return `<li><div class="row-head"><span>${esc(p.label)}</span><b>${trimNum(p.pts, 2)} / ${p.max}</b></div>
        ${bar(f, f >= 0.8 ? 'good' : f >= 0.6 ? 'watch' : f >= 0.4 ? 'warn' : 'bad')}
        <div class="row-sub muted">Input: ${fmt(p.fmt, p.input)}</div></li>`;
    }).join('');
    const hot = res.crash.items.filter((c) => c.pts > 0).sort((a, b) => b.pts - a.pts);
    const byKey = Object.fromEntries(TT.CRASH_VARS.map((c) => [c.key, c]));
    const crashRows = hot.slice(0, 7).map((c) => `<li><div class="row-head"><span>${esc(byKey[c.key].label)}</span><b>${trimNum(c.pts, 2)} pts</b></div>
        ${bar(c.pts / byKey[c.key].otherwise, c.tier.tone)}
        <div class="row-sub muted">Now ${fmt(byKey[c.key].fmt, c.value)} · ${esc(c.tier.label)}</div></li>`).join('');

    const k = res.kpi;
    const tile = (label, item, f, good) => {
      const tone = !isNum(item.diff) || item.diff === 0 ? 'neutral' : (item.diff > 0) === (good === 'up') ? 'good' : 'bad';
      return `<div class="tile"><span class="tile-label">${label}</span><span class="tile-value">${fmt(f, item.current)}</span>
        <span class="tile-change tone-text-${tone}">${f.startsWith('pct') ? fmtDiff(f, item.diff) : fmtPct(item.pct)} since start</span></div>`;
    };

    const ss = state.base.sheetScores || {};
    let parity = '';
    if (!overrideCount() && isNum(ss.health)) {
      const ok = ['supply', 'affordability', 'crash', 'health'].every((key) => isNum(ss[key]) && Math.abs(res[key].score - ss[key]) < 0.01);
      parity = ok
        ? '<p class="parity ok">✓ The scores calculated here match the source sheet’s own results.</p>'
        : `<p class="parity warn">⚠ The scores calculated here don’t match the source sheet’s results (sheet Housing Health: ${fmtScore(ss.health)}). The sheet’s formulas may have changed since this app was built.</p>`;
    }

    return `
      <section class="card hero">
        <div class="hero-gauge">${gauge(h.score, TT.TIERS.health, 'lg')}</div>
        <div class="hero-body">
          <p class="eyebrow">Housing Health Score</p>
          <div class="hero-num">${fmtScore(h.score)}<span class="of">/100</span></div>
          ${pill(h.tier, h.tier.tone === 'crisis' ? ' 🔥' : '')}
          ${whatIfNote(h.score, base.health.score)}
          <p class="lede">One number for the housing market: 45% affordability, 35% supply and 20% inverted crash likelihood.</p>
          <div class="stack" aria-hidden="true">${comp}</div>
          <ul class="legend">${compLegend}</ul>
        </div>
      </section>
      <section class="grid-3">
        ${scoreCard('Supply', 'Higher is better. Inventory compared with national targets.', res.supply, base.supply, TT.TIERS.supply, 'score-supply')}
        ${scoreCard('Affordability', 'Higher is better. Buyer affordability, rates and income.', res.affordability, base.affordability, TT.TIERS.affordability, 'score-afford')}
        ${scoreCard('Crash likelihood', 'Higher means closer to a crash. Points from 20 warning signs.', res.crash, base.crash, TT.TIERS.crash, 'score-crash')}
      </section>
      <section class="tiles">
        ${tile('30-yr mortgage rate', k.mortgageRate, 'pct2', 'down')}
        ${tile('Median resale home', k.resale, 'usd0', 'down')}
        ${tile('Homes for sale', k.totalForSale, 'int', 'up')}
        ${tile('Median household income', k.income, 'usd0', 'up')}
      </section>
      <section class="grid-3">
        <article class="card"><h3>Supply breakdown</h3><p class="muted small">Weighted inventory ratio ${N1.format(res.supply.ratio * 100)}% → score ${fmtScore(res.supply.score)}. The formula favors affordable (resale) housing.</p><ul class="rows">${supplyRows}</ul></article>
        <article class="card"><h3>Affordability breakdown</h3><p class="muted small">Five components add up to ${fmtScore(res.affordability.score)} of 100 points.</p><ul class="rows">${affRows}</ul></article>
        <article class="card"><h3>Crash warning signs</h3><p class="muted small">${hot.length} of ${res.crash.items.length} indicators are adding points (${trimNum(res.crash.raw, 2)} in total, capped at 100).</p><ul class="rows">${crashRows || '<li class="muted">No indicators are adding points.</li>'}</ul>
          <p><a href="#crash" class="more">See all 20 indicators →</a></p></article>
      </section>
      <section class="card legend-card">
        <h3>How to read the tiers</h3>
        <div class="tier-legends">
          ${tierLegend('Housing Health', TT.TIERS.health)}${tierLegend('Supply', TT.TIERS.supply)}
          ${tierLegend('Affordability', TT.TIERS.affordability)}${tierLegend('Crash likelihood', TT.TIERS.crash)}
        </div>
        ${parity}
      </section>`;
  }

  function tierLegend(title, tiers) {
    const items = tiers.map(([min, label, tone], i) => {
      const upper = i === 0 ? null : tiers[i - 1][0];
      const range = min === -Infinity ? `< ${upper}` : upper == null ? `≥ ${min}` : `${min}–${trimNum(upper - 0.1, 1)}`;
      return `<li><span class="dot tone-${tone}"></span>${esc(label)} <span class="muted">${range}</span></li>`;
    }).join('');
    return `<div><h4>${title}</h4><ul class="tier-list">${items}</ul></div>`;
  }

  function changeCell(name, item, good) {
    const tone = !isNum(item.diff) || Math.abs(item.diff) < 1e-12 || !good ? 'neutral' : (item.diff > 0) === (good === 'up') ? 'good' : 'bad';
    return `<td class="num tone-text-${tone}">${fmtDiff(name, item.diff)}</td><td class="num tone-text-${tone}">${fmtPct(item.pct)}</td>`;
  }

  function viewHousing(res) {
    const groups = TT.KPI_GROUPS.map((g) => {
      const rows = g.items.map((item) => {
        const r = res.kpi[item.key];
        const current = item.derived
          ? `<span class="derived" title="Total homes for sale minus new construction for sale">${fmt(item.fmt, r.current)}</span>`
          : cell(`kpi.${item.key}.current`, item.fmt, `${item.label} current value`);
        return `<tr><th scope="row">${link(item.url, esc(item.label)) || esc(item.label)}</th>
          <td class="num">${current}</td>
          <td class="num">${item.targetText ? esc(item.targetText) : fmt(item.fmt, r.target)}</td>
          <td class="num">${fmt(item.fmt, r.start)}</td>${changeCell(item.fmt, r, item.good)}</tr>`;
      }).join('');
      return `<tbody><tr class="group-row"><th colspan="6" scope="colgroup">${esc(g.title)}</th></tr>${rows}</tbody>`;
    }).join('');

    const regionHead = TT.REGIONS.map((r) => `<th scope="col" class="num">${r.label}</th>`).join('');
    const regionRows = TT.REGION_ROWS.map((row) => `<tr><th scope="row">${esc(row.label)}</th>${TT.REGIONS.map((reg) =>
      `<td class="num">${fmt(row.fmt, state.base.values[`region.${row.key}.${reg.key}`])}</td>`).join('')}</tr>`).join('');
    const yoy = TT.REGIONS.map((reg) => {
      const now = state.base.values[`region.today.${reg.key}`], last = state.base.values[`region.lastYear.${reg.key}`];
      const p = isNum(now) && isNum(last) && last ? (now - last) / last : null;
      return `<td class="num tone-text-${!isNum(p) || p === 0 ? 'neutral' : p > 0 ? 'good' : 'bad'}">${fmtPct(p)}</td>`;
    }).join('');

    return `
      <section class="card">
        <div class="card-head"><h2>Housing metrics</h2><p class="muted small">Click any value in the <b>Current</b> column to try a what-if. “Start” is the value when tracking began in January 2025. Metric names link to their sources.</p></div>
        <div class="table-wrap"><table class="data">
          <thead><tr><th scope="col">Metric</th><th scope="col" class="num">Current</th><th scope="col" class="num">Target</th><th scope="col" class="num">Start</th><th scope="col" class="num">Change</th><th scope="col" class="num">%</th></tr></thead>
          ${groups}
        </table></div>
        <ul class="notes">${TT.KPI_NOTES.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
      </section>
      <section class="card">
        <div class="card-head"><h2>Affordability by region</h2><p class="muted small">From the National Association of Realtors (NAR) affordability index. 100 means a median-income family earns exactly enough to qualify for a mortgage on a median-priced home. Above 100 is more affordable. ${link(TT.REGION_URL, 'NAR report')}</p></div>
        <div class="table-wrap"><table class="data">
          <thead><tr><th scope="col">Metric</th>${regionHead}</tr></thead>
          <tbody>${regionRows}<tr class="total-row"><th scope="row">Yearly change</th>${yoy}</tr></tbody>
        </table></div>
      </section>`;
  }

  function ruleText(c) {
    const op = { '<': '<', '<=': '≤', '>': '>', '>=': '≥', '=': '=' };
    return c.rules.map(([o, t, p]) => `${op[o]} ${fmtThreshold(c.fmt, t)} → ${trimNum(p, 2)}`).join(' · ') + ` · else ${trimNum(c.otherwise, 2)}`;
  }

  function viewCrash(res, base) {
    const items = Object.fromEntries(res.crash.items.map((c) => [c.key, c]));
    const rows = TT.CRASH_VARS.map((c) => {
      const it = items[c.key];
      return `<tr>
        <th scope="row">${link(c.url, esc(c.label)) || esc(c.label)}${c.note ? `<div class="row-note">${esc(c.note)}</div>` : ''}</th>
        <td class="num">${cell(`crash.${c.key}`, c.fmt, `${c.label} current value`)}</td>
        <td class="num"><b>${trimNum(it.pts, 2)}</b> <span class="muted">/ ${trimNum(c.otherwise, 2)}</span></td>
        <td>${pill(it.tier)}</td>
        <td><span class="cat cat-${c.category.toLowerCase()}">${esc(c.category)}</span></td>
        <td class="rule">${esc(ruleText(c))}</td></tr>`;
    }).join('');
    return `
      <section class="card crash-summary">
        <div>${gauge(res.crash.score, TT.TIERS.crash)}</div>
        <div>
          <p class="eyebrow">Crash likelihood</p>
          <div class="hero-num">${fmtScore(res.crash.score)}<span class="of">/100</span></div>
          ${pill(res.crash.tier)} ${whatIfNote(res.crash.score, base.crash.score)}
          <p class="lede">Each indicator adds points as it moves into riskier ranges. The total (${trimNum(res.crash.raw, 2)}) is capped at 100. Critical signs carry the most points.</p>
        </div>
      </section>
      <section class="card">
        <div class="card-head"><h2>All 20 indicators</h2><p class="muted small">Edit a <b>Current</b> value to see how points, tiers and every score respond.</p></div>
        <div class="table-wrap"><table class="data crash-table">
          <thead><tr><th scope="col">Indicator</th><th scope="col" class="num">Current</th><th scope="col" class="num">Points</th><th scope="col">Risk</th><th scope="col">Weight</th><th scope="col">Scoring rule</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </section>`;
  }

  function viewCosts(res) {
    const econ = state.base.econ;
    const last = econ[econ.length - 1];
    const yearAgo = last && econ.slice().reverse().find((p) => p.t <= last.t - 360 * 864e5);
    const econYoy = last && yearAgo ? (last.v - yearAgo.v) / yearAgo.v : null;

    const { q, group, sort } = state.cost;
    const needle = TT.norm(q);
    let list = TT.COST_ITEMS.filter((i) => (group === 'all' || i.group === group) && (!needle || TT.norm(i.label).includes(needle)));
    const pctOf = (i) => (isNum(res.costs[i.key].pct) ? res.costs[i.key].pct : null);
    if (sort === 'rise') list = list.slice().sort((a, b) => (pctOf(b) ?? -Infinity) - (pctOf(a) ?? -Infinity));
    if (sort === 'drop') list = list.slice().sort((a, b) => (pctOf(a) ?? Infinity) - (pctOf(b) ?? Infinity));
    if (sort === 'az') list = list.slice().sort((a, b) => a.label.localeCompare(b.label));

    const counts = {};
    TT.COST_ITEMS.forEach((i) => { const t = res.costs[i.key].trend; if (t) counts[t.label] = (counts[t.label] || 0) + 1; });
    const chips = ['Major rise', 'Rise', 'Stable', 'Drop', 'Major drop'].map((l) => {
      const t = TT.trendFor({ 'Major rise': 0.2, Rise: 0.05, Stable: 0, Drop: -0.05, 'Major drop': -0.2 }[l]);
      return `<span class="chip"><span class="dot tone-${t.tone}"></span>${l} <b>${counts[l] || 0}</b></span>`;
    }).join('');

    const rows = list.map((i) => {
      const c = res.costs[i.key];
      const name = i.fmt === 'price' ? 'price' : 'index';
      const tone = !c.trend ? 'neutral' : c.trend.tone;
      return `<tr><th scope="row">${link(i.url, esc(i.label)) || esc(i.label)}<span class="muted unit">${i.group === 'builder' ? 'builder' : i.fmt === 'price' ? 'avg price' : 'price index'}</span></th>
        <td class="num">${cell(`cost.${i.key}.current`, name, `${i.label} current value`)}</td>
        <td class="num">${fmt(name, c.start)}</td>
        <td class="num tone-text-${tone}">${fmtDiff(name, c.diff)}</td>
        <td class="num tone-text-${tone}">${fmtPct(c.pct)}</td>
        <td>${c.trend ? `<span class="trend tone-text-${c.trend.tone}">${c.trend.arrow} ${c.trend.label}</span>` : '—'}</td></tr>`;
    }).join('');

    const opt = (val, label, cur) => `<option value="${val}"${val === cur ? ' selected' : ''}>${label}</option>`;
    return `
      <section class="card">
        <div class="card-head"><h2>Household cost index <span class="badge">beta</span></h2>
          <p class="muted small">Compares each item’s current cost with its cost in Q1 2019. Essentials (food, utilities, rent, insurance, medical) count more than discretionary bills. Q1 2019 = 100. The source sheet labels this “under construction”.</p></div>
        ${last ? `<div class="econ-stats"><div><span class="tile-label">Latest</span><span class="tile-value">${N1.format(last.v)}</span><span class="muted small">${new Date(last.t).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })}</span></div>
          <div><span class="tile-label">vs. Q1 2019</span><span class="tile-value tone-text-bad">${fmtPct((last.v - 100) / 100)}</span></div>
          <div><span class="tile-label">Past year</span><span class="tile-value tone-text-${isNum(econYoy) && econYoy > 0 ? 'bad' : 'good'}">${fmtPct(econYoy)}</span></div></div>` : ''}
        ${lineChart(econ)}
      </section>
      <section class="card">
        <div class="card-head"><h2>Cost trackers</h2><p class="muted small">${TT.COST_ITEMS.length} building and household costs compared with January 2025. Prices are US city averages. Index values are Consumer Price Index (CPI) or Producer Price Index (PPI) levels. Rises of 1% or more are flagged, and 10% or more counts as major.</p></div>
        <div class="chips">${chips}</div>
        <div class="controls">
          <label class="search"><span class="sr-only">Search costs</span><input type="search" placeholder="Search, e.g. eggs" value="${esc(q)}" data-fid="cost-q" data-cost="q"></label>
          <label><span class="sr-only">Group</span><select data-cost="group" data-fid="cost-group">${opt('all', 'All costs', group)}${opt('builder', 'Builder expenses', group)}${opt('household', 'Household expenses', group)}</select></label>
          <label><span class="sr-only">Sort</span><select data-cost="sort" data-fid="cost-sort">${opt('sheet', 'Sheet order', sort)}${opt('rise', 'Biggest rise first', sort)}${opt('drop', 'Biggest drop first', sort)}${opt('az', 'A to Z', sort)}</select></label>
        </div>
        <div class="table-wrap"><table class="data">
          <thead><tr><th scope="col">Item</th><th scope="col" class="num">Current</th><th scope="col" class="num">Start</th><th scope="col" class="num">Change</th><th scope="col" class="num">%</th><th scope="col">Trend</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="6" class="muted">No items match.</td></tr>'}</tbody>
        </table></div>
      </section>`;
  }

  function viewBudget(res, base) {
    const b = res.budget;
    const tone = b.index >= 100 ? 'good' : b.index >= 90 ? 'watch' : b.index >= 75 ? 'warn' : 'bad';
    const linked = [
      ['kpi.income.current', 'usd0', 'Median household income'],
      ['kpi.resale.current', 'usd0', 'Median resale home value'],
      ['kpi.mortgageRate.current', 'pct2', '30-year mortgage rate'],
      ['cost.gas.current', 'price', 'Gas price per gallon'],
    ].map(([key, f, label]) => `<tr><th scope="row">${label}</th><td class="num">${cell(key, f, label)}</td></tr>`).join('');
    const assumptions = TT.BUDGET_INPUTS.map((i) => `<tr><th scope="row">${esc(i.label.replace(/^Base /, ''))}</th><td class="num">${cell(`budget.${i.key}`, i.fmt, i.label)}</td></tr>`).join('');
    const lines = b.lines.map((l) => `<tr><th scope="row">${esc(l.label)}${l.note ? `<div class="row-note">${esc(l.note)}</div>` : ''}</th><td class="num">${fmt('usd0', l.monthly)}</td><td class="num">${fmt('usd0', l.annual)}</td></tr>`).join('');
    const delta = overrideCount() && Math.abs(b.index - base.budget.index) >= 0.05
      ? `<p class="whatif-note">What-if: ${b.index - base.budget.index > 0 ? '+' : ''}${N1.format(b.index - base.budget.index)} vs. source (${N1.format(base.budget.index)})</p>` : '';
    return `
      <section class="card hero budget-hero">
        <div class="hero-body">
          <p class="eyebrow">Household Affordability Index</p>
          <div class="hero-num tone-text-${tone}">${N1.format(b.index)}<span class="of"> / 100 = break-even</span></div>
          ${delta}
          <p class="lede">A median household earns <b>${fmt('usd0', b.income)}</b> a year. A typical family budget below costs <b>${fmt('usd0', b.annualBudget)}</b> a year (${fmt('usd0', b.monthlyBudget)} a month).
          ${b.index >= 100 ? 'Income covers the budget.' : `That leaves a <b>${fmt('usd0', b.annualBudget - b.income)}</b> yearly gap.`}</p>
          ${bar(b.index / 120, tone)}
        </div>
      </section>
      <section class="grid-2">
        <article class="card">
          <h3>Inputs</h3>
          <p class="muted small">These four come from the tracker. Changing them here also changes them on the other tabs.</p>
          <table class="data compact"><tbody>${linked}</tbody></table>
          <h3 class="mt">Assumptions</h3>
          <table class="data compact"><tbody>${assumptions}</tbody></table>
        </article>
        <article class="card">
          <h3>Budget</h3>
          <div class="table-wrap"><table class="data">
            <thead><tr><th scope="col">Line item</th><th scope="col" class="num">Monthly</th><th scope="col" class="num">Annual</th></tr></thead>
            <tbody>${lines}
              <tr class="total-row"><th scope="row">Total budget</th><td class="num">${fmt('usd0', b.monthlyBudget)}</td><td class="num">${fmt('usd0', b.annualBudget)}</td></tr>
              <tr><th scope="row">Median income</th><td class="num">${fmt('usd0', b.income / 12)}</td><td class="num">${fmt('usd0', b.income)}</td></tr>
            </tbody>
          </table></div>
        </article>
      </section>`;
  }

  function viewPromises() {
    const rows = state.base.promises.map((p) => `<tr>
      <th scope="row">${esc(p.promise)}</th><td>${esc(p.stat)}</td>
      <td class="num">${fmt(p.fmt, p.fmt === 'text' ? p.start : (isNum(p.start) ? p.start : null))}</td>
      <td class="num">${fmt(p.fmt, p.fmt === 'text' ? p.current : (isNum(p.current) ? p.current : null))}</td>
      <td><span class="pill tone-${/^yes/i.test(p.fulfilled) ? 'good' : /^no/i.test(p.fulfilled) ? 'bad' : 'neutral'}">${esc(p.fulfilled || '—')}</span></td>
      <td>${link(p.url, 'source') || '<span class="muted">—</span>'}</td></tr>`).join('');
    const res = TT.RESOURCES.map((r) => `<li>${link(r.url, esc(r.label))}</li>`).join('');
    return `
      <section class="card">
        <div class="card-head"><h2>Campaign promises</h2><p class="muted small">Housing promises and the statistic tracked for each, as recorded in the source sheet.</p></div>
        <div class="table-wrap"><table class="data">
          <thead><tr><th scope="col">Promise</th><th scope="col">Stat tracked</th><th scope="col" class="num">Start</th><th scope="col" class="num">Current</th><th scope="col">Fulfilled?</th><th scope="col">Source</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </section>
      <section class="grid-2">
        <article class="card"><h3>Links with promises and updates</h3><ul class="link-list">${res}</ul></article>
        <article class="card"><h3>About this local copy</h3>
          <p>This is an unofficial local copy of the ${link(TT.SHEET_URL, 'T.R.U.M.P. Tracker')} by ${link(TT.LINKTREE_URL, '@zacharyloft')}. The data and scoring model are his. This app does three things:</p>
          <ul class="link-list plain">
            <li><b>Mirrors</b> the public sheet. <i>Sync</i> pulls the latest numbers. The sheet updates daily at 9:15 AM Eastern.</li>
            <li><b>Recalculates</b> every score on your machine with the sheet’s formulas, and checks the result against the sheet.</li>
            <li><b>Lets you test what-ifs.</b> Change any current value and every score updates. Your edits stay in this browser until you reset them.</li>
          </ul>
        </article>
      </section>`;
  }

  const VIEWS = { dashboard: viewDashboard, housing: viewHousing, crash: viewCrash, costs: viewCosts, budget: viewBudget, promises: viewPromises };

  // ---------- chrome ----------
  function renderStatus() {
    const el = document.getElementById('status');
    const src = state.base.source;
    let dotTone, text;
    if (state.syncing) { dotTone = 'watch'; text = 'Syncing with the source sheet…'; }
    else if (state.syncError) { dotTone = 'bad'; text = `Sync failed (${esc(state.syncError)}). Showing ${src.kind === 'synced' ? `data synced ${relTime(src.fetchedAt)}` : 'the bundled snapshot'}.`; }
    else if (src.kind === 'synced') { dotTone = 'good'; text = `Live data, synced ${relTime(src.fetchedAt)}`; }
    else { dotTone = 'neutral'; text = `Bundled snapshot from ${relTime(src.fetchedAt)}`; }
    const missing = state.base.missing && state.base.missing.length && src.kind === 'synced'
      ? `<span class="status-line warn">${state.base.missing.length} metric(s) were missing from the sheet and use bundled values.</span>` : '';
    el.innerHTML = `<span class="status-line"><span class="dot tone-${dotTone}${state.syncing ? ' pulse' : ''}"></span>${text}</span>
      ${state.base.updated ? `<span class="status-line muted">Source updated ${esc(state.base.updated)}</span>` : ''}${missing}`;
    const syncBtn = document.getElementById('sync-btn');
    syncBtn.disabled = state.syncing;
    syncBtn.textContent = state.syncing ? 'Syncing…' : 'Sync now';
    const n = overrideCount();
    const banner = document.getElementById('whatif-banner');
    banner.hidden = !n;
    banner.querySelector('[data-count]').textContent = `${n} value${n === 1 ? '' : 's'} changed`;
  }

  function renderTabs() {
    document.getElementById('tabs').innerHTML = TABS.map(([id, label]) =>
      `<a href="#${id}" role="tab" class="tab" aria-selected="${state.tab === id}" ${state.tab === id ? 'aria-current="page"' : ''}>${label}</a>`).join('');
  }

  function render() {
    const view = document.getElementById('view');
    const ae = document.activeElement;
    const fid = ae && view.contains(ae) && ae.dataset ? (ae.dataset.fid || ae.dataset.key) : null;
    const caret = fid && ae.selectionStart != null && ae.type === 'search' ? ae.selectionStart : null;

    const res = TT.calc(effectiveValues());
    const base = overrideCount() ? TT.calc(state.base.values) : res;
    renderStatus();
    renderTabs();
    view.innerHTML = VIEWS[state.tab](res, base);

    if (fid) {
      const el = view.querySelector(`[data-fid="${CSS.escape(fid)}"], [data-key="${CSS.escape(fid)}"]`);
      if (el) { el.focus(); if (caret != null) el.setSelectionRange(caret, caret); }
    }
  }

  async function sync() {
    if (state.syncing) return;
    state.syncing = true;
    state.syncError = null;
    renderStatus();
    try {
      const snap = await TT.syncFromSheet();
      const parsed = TT.parseResponses(snap.responses);
      store.set(KEYS.synced, snap);
      state.base = withSnapshot(parsed, { kind: 'synced', fetchedAt: snap.fetchedAt });
    } catch (e) {
      state.syncError = e.message || String(e);
    }
    state.syncing = false;
    render();
  }

  function applyTheme(mode) {
    const root = document.documentElement;
    if (mode === 'light' || mode === 'dark') root.setAttribute('data-theme', mode); else root.removeAttribute('data-theme');
    document.getElementById('theme-btn').textContent = `Theme: ${mode === 'light' ? 'Light' : mode === 'dark' ? 'Dark' : 'Auto'}`;
  }

  function setTabFromHash() {
    const id = location.hash.replace('#', '');
    state.tab = VIEWS[id] ? id : 'dashboard';
  }

  // ---------- events ----------
  function bind() {
    const view = document.getElementById('view');

    view.addEventListener('focusin', (e) => {
      const el = e.target.closest('.cell-input');
      if (!el) return;
      el.value = editText(el.dataset.fmt, effectiveValues()[el.dataset.key]);
      requestAnimationFrame(() => el.select());
    });
    view.addEventListener('focusout', (e) => {
      const el = e.target.closest('.cell-input');
      if (el) el.value = fmt(el.dataset.fmt, effectiveValues()[el.dataset.key]);
    });
    view.addEventListener('change', (e) => {
      const el = e.target;
      if (el.classList.contains('cell-input')) {
        const v = parseEdit(el.dataset.fmt, el.value);
        if (isNum(v)) setOverride(el.dataset.key, v);
        requestAnimationFrame(render);
      } else if (el.dataset.cost) {
        state.cost[el.dataset.cost] = el.value;
        render();
      }
    });
    view.addEventListener('input', (e) => {
      if (e.target.dataset.cost === 'q') { state.cost.q = e.target.value; render(); }
    });
    view.addEventListener('keydown', (e) => {
      const el = e.target.closest('.cell-input');
      if (!el) return;
      if (e.key === 'Enter') { el.blur(); }
      if (e.key === 'Escape') { el.value = editText(el.dataset.fmt, effectiveValues()[el.dataset.key]); el.blur(); }
    });
    view.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-reset]');
      if (!btn) return;
      delete state.overrides[btn.dataset.reset];
      store.set(KEYS.overrides, state.overrides);
      render();
    });

    document.getElementById('sync-btn').addEventListener('click', sync);
    document.getElementById('reset-btn').addEventListener('click', () => {
      state.overrides = {};
      store.del(KEYS.overrides);
      render();
    });
    document.getElementById('theme-btn').addEventListener('click', () => {
      const order = ['auto', 'light', 'dark'];
      const next = order[(order.indexOf(store.get(KEYS.theme) || 'auto') + 1) % order.length];
      store.set(KEYS.theme, next);
      applyTheme(next);
    });
    window.addEventListener('hashchange', () => { setTabFromHash(); render(); window.scrollTo({ top: 0 }); });
  }

  function init() {
    state.base = loadBase();
    applyTheme(store.get(KEYS.theme) || 'auto');
    setTabFromHash();
    bind();
    render();
    const fetchedAt = Date.parse(state.base.source.fetchedAt) || 0;
    if (navigator.onLine !== false && (state.base.source.kind !== 'synced' || Date.now() - fetchedAt > AUTO_SYNC_AFTER_MS)) sync();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(window.TT = window.TT || {});
