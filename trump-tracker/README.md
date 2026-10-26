# T.R.U.M.P. Tracker: local copy

A local, offline-capable app version of the
[T.R.U.M.P. Tracker](https://docs.google.com/spreadsheets/d/1VNPGRB5ZcrxxIk_27Mmbe10nxc5wyCuHJPpD4ZGSvEU/edit)
housing dashboard by [@zacharyloft](https://linktr.ee/zacharyloft). The data and
the scoring model are his. This is an unofficial copy and is not affiliated with him.

## Run it

Open `index.html` in any modern browser (double-click it). There is nothing to
install and no server to run.

If your browser is strict about local files, serve the folder instead:

```sh
cd trump-tracker
python3 -m http.server 8000   # then open http://localhost:8000
```

## What it does

- **Dashboard**: the four headline scores (Housing Health, Supply,
  Affordability, Crash Likelihood) as gauges with their tiers, a breakdown of
  how each score is built, and a check that the local math matches the sheet.
- **Housing**: every housing KPI with its target, current value, start value
  (January 2025) and change, plus NAR affordability by region.
- **Crash watch**: all 20 crash indicators with their points, risk tier and the
  exact scoring thresholds.
- **Cost of living**: the household cost index chart (Q1 2019 = 100) and 64
  builder and household cost trackers, with search and sorting.
- **Household budget**: the sheet's Household Affordability Index calculator
  with editable assumptions.
- **Promises & links**: the campaign-promise table and reference links.

### Live sync

The app ships with a bundled snapshot (`data/snapshot.js`), so it works offline.
When it is online it pulls the latest numbers from the public sheet (on open if
the data is more than 6 hours old, or whenever you press **Sync now**). The
sheet itself updates every morning at 9:15 AM Eastern. Synced data is kept in
the browser for the next visit.

### What-if scenarios

Any **Current** value with a dashed box can be edited. Type a number such as
`6.25` for a percentage or `450000` for a dollar amount, then press Enter. Every
score recalculates right away and shows its change against the source value.
Edits are remembered in the browser until you press **Reset to source values**
or the ↺ next to a value.

## How it stays faithful to the sheet

The scoring formulas in `js/formulas.js` are ports of the sheet's own
spreadsheet formulas (`Q21`, `Q22`, `Q23`, `Q28`, column `E` of the crash
table, and the `Affordability Index` tab). The sync reads the sheet's computed
scores as well as its inputs. The dashboard says whether they agree, and the
tests check it:

```sh
cd trump-tracker
node --test        # Node 18+
```

Rows are matched by their label, not their position, so the sheet's author can
add or move rows without breaking the sync. If a metric can't be found, the app
falls back to the bundled value and says so in the header.

A few quirks in the source sheet are reproduced as-is, so the numbers match,
and are noted in the app:

- **Total Housing Supply** (crash table) compares a listing count against ratio
  thresholds, so it always scores 0.
- **Backdated Yield Curve** uses −0.5 and −1 as thresholds on a decimal value,
  so its top tiers only trigger on extreme inversions.
- The cost tracker for **Internet** shows +890% because the sheet's start value
  is on a different index base.

## Refreshing the bundled snapshot

```sh
python3 tools/update_snapshot.py
```

This runs the same queries as the in-app sync (listed in `js/queries.js`) and
rewrites `data/snapshot.js`. It uses only the Python standard library.

## Files

| Path | Purpose |
| --- | --- |
| `index.html`, `styles.css` | App shell and styling (light and dark themes) |
| `js/queries.js` | Which sheet ranges hold the data; shared with the Python tool |
| `js/model.js` | Metric labels, formats, source links, scoring thresholds and tiers |
| `js/data.js` | Turns sheet responses into a flat value map |
| `js/formulas.js` | The scoring model |
| `js/sync.js` | Live pull from the public sheet (JSONP, so it works from `file://`) |
| `js/app.js` | Rendering, what-if editing and state |
| `data/snapshot.js` | Bundled offline data |
| `tools/update_snapshot.py` | Regenerates the snapshot |
| `tests/formulas.test.js` | Checks the formulas against the sheet's own results |
