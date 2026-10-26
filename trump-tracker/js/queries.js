// Where the tracker's numbers live in the public Google Sheet.
// Shared by the app (js/sync.js) and tools/update_snapshot.py, so everything
// after the "=" must stay valid JSON.
window.TRACKER_SOURCE = {
  "sheetId": "1VNPGRB5ZcrxxIk_27Mmbe10nxc5wyCuHJPpD4ZGSvEU",
  "queries": {
    "updated":  { "sheet": "TRUMP TRACKER",       "range": "T1:U1" },
    "kpi":      { "sheet": "TRUMP TRACKER",       "range": "I1:N30" },
    "costA":    { "sheet": "TRUMP TRACKER",       "range": "P1:R30" },
    "costB":    { "sheet": "TRUMP TRACKER",       "range": "W1:Y60" },
    "crash":    { "sheet": "TRUMP TRACKER",       "range": "A30:D55" },
    "promises": { "sheet": "TRUMP TRACKER",       "range": "A9:F17" },
    "regions":  { "sheet": "TRUMP TRACKER",       "range": "A19:E28" },
    "econ":     { "sheet": "TRUMP TRACKER",       "range": "P33:Q120" },
    "budget":   { "sheet": "Affordability Index", "range": "H18:I33" },
    "budgetResult": { "sheet": "Affordability Index", "range": "A18:E21" }
  }
};
