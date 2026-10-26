// Checks that the app's ported formulas reproduce the scores the Google Sheet
// computed for the same data. Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

function loadApp() {
  const window = {};
  const context = vm.createContext({ window });
  for (const file of ['js/queries.js', 'js/model.js', 'js/data.js', 'js/formulas.js', 'data/snapshot.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });
  }
  return window;
}

const { TT, TRACKER_SNAPSHOT, TRACKER_SOURCE } = loadApp();
const data = TT.parseResponses(TRACKER_SNAPSHOT.responses);
const result = TT.calc(data.values);

test('snapshot has a response for every query', () => {
  for (const name of Object.keys(TRACKER_SOURCE.queries)) {
    assert.equal(TRACKER_SNAPSHOT.responses[name].status, 'ok', name);
  }
});

test('every metric is found in the sheet', () => {
  assert.equal(data.missing.length, 0, `missing: ${data.missing.join(', ')}`);
});

for (const key of ['supply', 'affordability', 'crash', 'health']) {
  test(`${key} score matches the sheet`, () => {
    const expected = data.sheetScores[key];
    assert.equal(typeof expected, 'number');
    assert.ok(Math.abs(result[key].score - expected) < 0.01, `local ${result[key].score} vs sheet ${expected}`);
  });
}

test('household budget index matches the sheet', () => {
  const expected = data.sheetScores.budgetIndex;
  assert.equal(typeof expected, 'number');
  assert.ok(Math.abs(result.budget.index - expected) < 0.01, `local ${result.budget.index} vs sheet ${expected}`);
});

test('economic index history is parsed in date order', () => {
  assert.ok(data.econ.length > 10);
  for (let i = 1; i < data.econ.length; i++) assert.ok(data.econ[i].t > data.econ[i - 1].t);
});

test('rule points follow the sheet thresholds', () => {
  const unemployment = TT.CRASH_VARS.find((c) => c.key === 'unemployment');
  assert.equal(TT.rulePoints(0.039, unemployment.rules, unemployment.otherwise), 0);
  assert.equal(TT.rulePoints(0.042, unemployment.rules, unemployment.otherwise), 3);
  assert.equal(TT.rulePoints(0.12, unemployment.rules, unemployment.otherwise), 12);
});

test('what-if overrides change the scores', () => {
  const lowerRate = Object.assign({}, data.values, { 'kpi.mortgageRate.current': 0.045 });
  const whatIf = TT.calc(lowerRate);
  assert.ok(whatIf.affordability.score > result.affordability.score);
  assert.ok(whatIf.health.score > result.health.score);
});
