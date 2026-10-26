// The tracker's scoring model, ported from the formulas in the TRUMP TRACKER
// and Affordability Index tabs. Pure functions: values map in, results out.
(function (TT) {
  const OPS = {
    '<': (a, b) => a < b, '<=': (a, b) => a <= b,
    '>': (a, b) => a > b, '>=': (a, b) => a >= b, '=': (a, b) => a === b,
  };

  TT.rulePoints = function (value, rules, otherwise) {
    for (const [op, threshold, pts] of rules) if (OPS[op](value, threshold)) return pts;
    return otherwise;
  };

  TT.tierFor = function (tiers, score) {
    for (const [min, label, tone] of tiers) if (score >= min) return { label, tone };
    const last = tiers[tiers.length - 1];
    return { label: last[1], tone: last[2] };
  };

  // =IFS(AC17>=0.9, 100, AC17>=0.8, (AC17-0.8)*190+80, ...)
  TT.supplyScore = function (ratio) {
    if (ratio >= 0.9) return 100;
    if (ratio >= 0.8) return (ratio - 0.8) * 190 + 80;
    if (ratio >= 0.65) return (ratio - 0.65) * 126.67 + 60;
    if (ratio >= 0.45) return (ratio - 0.45) * 100 + 40;
    if (ratio >= 0.3) return (ratio - 0.3) * 126.67 + 20;
    return ratio * 30 + 10;
  };

  // The five components summed in cell Q22.
  TT.AFFORDABILITY_PARTS = [
    { key: 'fthb', label: 'First-time buyer affordability', input: 'kpi.fthb.current', fmt: 'num1', max: 40,
      fn: (k) => k >= 95 ? 40 : k >= 90 ? 35 + (k - 90) : k >= 85 ? 30 + (k - 85) : k >= 80 ? 25 + (k - 80)
        : k >= 70 ? 18 + (k - 70) * 0.7 : k >= 60 ? 12 + (k - 60) * 0.6 : 6 },
    { key: 'hai', label: 'National affordability index', input: 'kpi.hai.current', fmt: 'num1', max: 20,
      fn: (k) => k >= 125 ? 20 : k >= 115 ? 17 + (k - 115) * 0.3 : k >= 105 ? 13 + (k - 105) * 0.4
        : k >= 95 ? 9 + (k - 95) * 0.4 : k >= 85 ? 6 + (k - 85) * 0.3 : 3 },
    { key: 'mortgage', label: 'Mortgage rate', input: 'kpi.mortgageRate.current', fmt: 'pct2', max: 15,
      fn: (k) => k <= 0.045 ? 15 : k <= 0.05 ? 12 + (0.05 - k) * 600 : k <= 0.055 ? 9 + (0.055 - k) * 600
        : k <= 0.06 ? 6 + (0.06 - k) * 600 : k <= 0.065 ? 3 + (0.065 - k) * 600 : k <= 0.07 ? 1.5 + (0.07 - k) * 300 : 0 },
    { key: 'treasury', label: '10-year Treasury', input: 'kpi.treasury10y.current', fmt: 'pct2', max: 7.5,
      fn: (k) => k <= 0.023 ? 7.5 : k <= 0.03 ? 6 + (0.03 - k) / 0.007 * 1.5 : k <= 0.04 ? 4.5 + (0.04 - k) / 0.01 * 1.5
        : k <= 0.045 ? 3 + (0.045 - k) / 0.005 * 1.5 : k <= 0.05 ? 1.5 + (0.05 - k) / 0.005 * 1.5 : 0 },
    { key: 'income', label: 'Median household income', input: 'kpi.income.current', fmt: 'usd0', max: 17.5,
      fn: (k) => k >= 100000 ? 17.5 : k >= 97000 ? 15 + (k - 97000) / 3000 * 2.5 : k >= 90000 ? 12 + (k - 90000) / 7000 * 3
        : k >= 85000 ? 9 + (k - 85000) / 5000 * 3 : k >= 80000 ? 6 + (k - 80000) / 5000 * 3 : 3 },
  ];

  // Weighted inventory ratios in cell AC17.
  TT.SUPPLY_PARTS = [
    { key: 'resaleForSale', label: 'Resale homes for sale', weight: 0.5 },
    { key: 'newForSale', label: 'New construction for sale', weight: 0.25 },
    { key: 'permits', label: 'Building permits', weight: 0.15 },
    { key: 'totalForSale', label: 'Total homes for sale', weight: 0.1 },
  ];

  const CRASH_SCALE = 135;

  function changeOf(current, start) {
    if (typeof current !== 'number' || typeof start !== 'number') return { pct: null, diff: null };
    return { pct: start === 0 ? null : (current - start) / start, diff: current - start };
  }

  // =IF((Q3-R3)/R3 >= 0.1, "⬆️⬆️ MAJOR Rise", ...)
  TT.trendFor = function (pct) {
    if (pct === null) return null;
    if (pct >= 0.1) return { label: 'Major rise', tone: 'bad', arrow: '▲▲' };
    if (pct >= 0.01) return { label: 'Rise', tone: 'warn', arrow: '▲' };
    if (pct <= -0.1) return { label: 'Major drop', tone: 'good', arrow: '▼▼' };
    if (pct <= -0.01) return { label: 'Drop', tone: 'good', arrow: '▼' };
    return { label: 'Stable', tone: 'neutral', arrow: '■' };
  };

  TT.monthlyPayment = function (principal, annualRate, years) {
    const n = years * 12;
    const r = annualRate / 12;
    if (!n) return 0;
    if (!r) return principal / n;
    return principal * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
  };

  TT.calc = function (values) {
    const v = (k) => (typeof values[k] === 'number' ? values[k] : NaN);

    // KPI table, including the derived resale inventory (K23 = K21 - K22).
    const kpi = {};
    for (const g of TT.KPI_GROUPS) {
      for (const item of g.items) {
        let current = values[`kpi.${item.key}.current`];
        let start = values[`kpi.${item.key}.start`];
        if (item.key === 'resaleForSale') {
          current = v('kpi.totalForSale.current') - v('kpi.newForSale.current');
          start = v('kpi.totalForSale.start') - v('kpi.newForSale.start');
        }
        kpi[item.key] = Object.assign({ target: values[`kpi.${item.key}.target`], current, start }, changeOf(current, start));
      }
    }

    const supplyParts = TT.SUPPLY_PARTS.map((p) => {
      const ratio = kpi[p.key].current / kpi[p.key].target;
      return Object.assign({}, p, { current: kpi[p.key].current, target: kpi[p.key].target, ratio, contrib: ratio * p.weight });
    });
    const supplyRatio = supplyParts.reduce((s, p) => s + p.contrib, 0);
    const supplyScore = TT.supplyScore(supplyRatio);

    const affParts = TT.AFFORDABILITY_PARTS.map((p) => {
      const input = v(p.input);
      return { key: p.key, label: p.label, input, fmt: p.fmt, max: p.max, pts: p.fn(input) };
    });
    const affScore = affParts.reduce((s, p) => s + p.pts, 0);

    const crashItems = TT.CRASH_VARS.map((c) => {
      const value = v(`crash.${c.key}`);
      const pts = TT.rulePoints(value, c.rules, c.otherwise);
      return { key: c.key, value, pts, tier: TT.tierFor(TT.TIERS.crashItem, pts) };
    });
    const crashRaw = crashItems.reduce((s, c) => s + c.pts, 0);
    const crashScore = Math.min(100, crashRaw);

    const invertedCrash = (CRASH_SCALE - crashScore) / CRASH_SCALE * 100;
    const healthParts = [
      { key: 'affordability', label: 'Affordability', weight: 0.45, value: affScore },
      { key: 'supply', label: 'Supply', weight: 0.35, value: supplyScore },
      { key: 'crash', label: 'Inverted crash likelihood', weight: 0.2, value: invertedCrash },
    ].map((p) => Object.assign(p, { contrib: p.value * p.weight }));
    const healthScore = healthParts.reduce((s, p) => s + p.contrib, 0);

    const costs = {};
    for (const item of TT.COST_ITEMS) {
      const current = values[`cost.${item.key}.current`];
      const start = values[`cost.${item.key}.start`];
      const ch = changeOf(current, start);
      costs[item.key] = Object.assign({ current, start, trend: TT.trendFor(ch.pct) }, ch);
    }

    // "Affordability Index" tab: income / annual household budget x 100.
    const income = v('kpi.income.current');
    const home = v('kpi.resale.current');
    const rate = v('kpi.mortgageRate.current');
    const gasPrice = v('cost.gas.current');
    const b = (k) => v(`budget.${k}`);
    const lines = [
      { label: 'Monthly mortgage', monthly: TT.monthlyPayment(home * (1 - b('downPct')), rate, b('termYears')), note: 'Median resale home, current rate, your down payment and term' },
      { label: '2 used car payments', monthly: b('carPayment') * 2, note: 'Two cars' },
      { label: 'Student loan payment', monthly: b('studentLoan'), note: 'Flat assumption' },
      { label: 'Childcare (1 kid)', monthly: b('childcare'), note: '' },
      { label: 'Food (family)', monthly: b('food'), note: '' },
      { label: 'Electric bill', monthly: b('electric'), note: '' },
      { label: 'Family healthcare', monthly: b('healthcare'), note: '' },
      { label: 'Auto insurance', monthly: b('autoInsurance'), note: '' },
      { label: 'Gas (2 cars)', monthly: gasPrice * b('gallons') * b('tanks'), note: 'Gas price × gallons per tank × tanks per month' },
      { label: 'Phone bill', monthly: b('phone'), note: 'Flat assumption' },
      { label: 'Internet', monthly: b('internet'), note: '' },
      { label: 'Taxes (effective)', monthly: income * b('taxRate') / 12, note: 'Income × effective tax rate ÷ 12' },
    ].map((l) => Object.assign(l, { annual: l.monthly * 12 }));
    const annualBudget = lines.reduce((s, l) => s + l.annual, 0);
    const budget = { lines, annualBudget, monthlyBudget: annualBudget / 12, income, index: income / annualBudget * 100 };

    return {
      kpi, costs, budget,
      supply: { score: supplyScore, ratio: supplyRatio, parts: supplyParts, tier: TT.tierFor(TT.TIERS.supply, supplyScore) },
      affordability: { score: affScore, parts: affParts, tier: TT.tierFor(TT.TIERS.affordability, affScore) },
      crash: { score: crashScore, raw: crashRaw, items: crashItems, tier: TT.tierFor(TT.TIERS.crash, crashScore) },
      health: { score: healthScore, parts: healthParts, tier: TT.tierFor(TT.TIERS.health, healthScore) },
    };
  };
})(window.TT = window.TT || {});
