// Turns raw Google Sheets "gviz" query responses into the flat value map the
// app works with. Rows are found by their label, so the sheet's owner can
// insert or move rows without breaking the sync.
(function (TT) {
  const norm = (s) => String(s == null ? '' : s).replace(/\*+/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

  // gviz encodes dates as "Date(2025,11,30)" with a zero-based month.
  function cellValue(cell) {
    if (!cell) return null;
    const v = cell.v;
    if (typeof v === 'string') {
      const m = /^Date\((\d+),(\d+),(\d+)/.exec(v);
      if (m) return Date.UTC(+m[1], +m[2], +m[3]);
    }
    return v === undefined ? null : v;
  }

  // Rows as objects keyed by column letter: [{ I: 'Mortgage Rate', J: 0.0672, ... }]
  function rowsOf(resp) {
    if (!resp || !resp.table) return [];
    const ids = resp.table.cols.map((c) => c.id);
    return resp.table.rows.map((r) => {
      const row = {};
      ids.forEach((id, i) => { row[id] = cellValue(r.c && r.c[i]); });
      return row;
    });
  }

  function indexByLabel(resp, labelCol) {
    const map = new Map();
    for (const row of rowsOf(resp)) {
      const k = norm(row[labelCol]);
      if (k && !map.has(k)) map.set(k, row);
    }
    return map;
  }

  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);

  TT.norm = norm;

  // responses: { queryName: gvizResponse } as listed in js/queries.js.
  // Returns { values, updated, promises, econ, sheetScores, missing }.
  TT.parseResponses = function (responses) {
    const values = {};
    const missing = [];
    const put = (key, v) => { if (v !== null) values[key] = v; };

    const kpi = indexByLabel(responses.kpi, 'I');
    for (const g of TT.KPI_GROUPS) {
      for (const item of g.items) {
        const row = kpi.get(norm(item.match || item.label));
        if (!row) { missing.push(item.label); continue; }
        put(`kpi.${item.key}.target`, num(row.J));
        if (!item.derived) {
          put(`kpi.${item.key}.current`, num(row.K));
          put(`kpi.${item.key}.start`, num(row.L));
        }
      }
    }

    const costCols = { P: { resp: 'costA', cur: 'Q', start: 'R' }, W: { resp: 'costB', cur: 'X', start: 'Y' } };
    const costIdx = { P: indexByLabel(responses.costA, 'P'), W: indexByLabel(responses.costB, 'W') };
    for (const item of TT.COST_ITEMS) {
      const c = costCols[item.col];
      const row = costIdx[item.col].get(norm(item.match || item.label));
      if (!row) { missing.push(item.label); continue; }
      put(`cost.${item.key}.current`, num(row[c.cur]));
      put(`cost.${item.key}.start`, num(row[c.start]));
    }

    const crash = indexByLabel(responses.crash, 'A');
    for (const item of TT.CRASH_VARS) {
      const row = crash.get(norm(item.match || item.label));
      if (!row) { missing.push(item.label); continue; }
      put(`crash.${item.key}`, num(row.D));
    }

    const regions = indexByLabel(responses.regions, 'A');
    for (const r of TT.REGION_ROWS) {
      const row = regions.get(norm(r.match || r.label));
      if (!row) { missing.push(r.label); continue; }
      for (const reg of TT.REGIONS) put(`region.${r.key}.${reg.key}`, num(row[reg.col]));
    }

    const budget = indexByLabel(responses.budget, 'H');
    for (const b of TT.BUDGET_INPUTS) {
      const row = budget.get(norm(b.label));
      if (!row) { missing.push(b.label); continue; }
      put(`budget.${b.key}`, num(row.I));
    }

    const promiseRows = indexByLabel(responses.promises, 'A');
    const promises = TT.PROMISES.map((p) => {
      const row = promiseRows.get(norm(p.match)) || {};
      return {
        promise: p.match, stat: row.B ? String(row.B).trim() : '', start: row.C, current: row.D,
        fulfilled: row.E ? String(row.E).trim() : '', fmt: p.fmt, url: p.url,
      };
    });

    const econ = rowsOf(responses.econ)
      .filter((r) => typeof r.P === 'number' && num(r.Q) !== null)
      .map((r) => ({ t: r.P, v: r.Q }))
      .sort((a, b) => a.t - b.t);

    const scoreRows = indexByLabel(responses.costA, 'P');
    const resultRows = indexByLabel(responses.budgetResult, 'A');
    const sheetScore = (label, idx, col) => { const r = idx.get(label); return r ? num(r[col]) : null; };
    const sheetScores = {
      supply: sheetScore('supply', scoreRows, 'Q'),
      affordability: sheetScore('affordability', scoreRows, 'Q'),
      crash: sheetScore('crash likelihood', scoreRows, 'Q'),
      health: sheetScore('today', scoreRows, 'Q'),
      budgetIndex: sheetScore('affordability index', resultRows, 'E'),
    };

    // Two "LAST UPDATED" stamps exist in row 1; the newest one is current.
    let updated = null;
    let updatedTime = -Infinity;
    for (const row of rowsOf(responses.updated)) {
      for (const v of Object.values(row)) {
        const m = typeof v === 'string' && /LAST UPDATED:\s*(.+)$/i.exec(v);
        if (!m) continue;
        const t = Date.parse(m[1].replace(/\s+[A-Z]{2,4}$/, '')) || 0;
        if (t >= updatedTime) { updatedTime = t; updated = m[1].trim(); }
      }
    }

    return { values, updated, promises, econ, sheetScores, missing };
  };
})(window.TT = window.TT || {});
