// Static description of every metric on the tracker: labels, formats, source
// links, scoring rules and score tiers. Labels in `match` must equal the row
// labels in the Google Sheet (case, spacing and trailing * are ignored).
(function (TT) {
  const fred = (id) => `https://fred.stlouisfed.org/series/${id}`;
  const NAR_HAI = 'https://www.nar.realtor/sites/default/files/2025-11/hai-09-2025-housing-affordability-index-2025-11-06.pdf';
  const NAR_FTHB = 'https://www.nar.realtor/sites/default/files/2025-08/hai-q2-2025-first-time-homebuyer-affordability-2025-08-12.pdf';
  const NAR_FTHB_Q3 = 'https://www.nar.realtor/sites/default/files/2025-11/hai-q3-2025-first-time-homebuyer-affordability-2025-11-06.pdf';
  const NAR_REGION = 'https://www.nar.realtor/sites/default/files/2025-02/hai-q4-2024-first-time-homebuyer-affordability-2025-02-06.pdf';

  TT.SHEET_URL = 'https://docs.google.com/spreadsheets/d/1VNPGRB5ZcrxxIk_27Mmbe10nxc5wyCuHJPpD4ZGSvEU/edit';
  TT.LINKTREE_URL = 'https://linktr.ee/zacharyloft';

  // good: which direction of change is good news ('up' | 'down' | null).
  TT.KPI_GROUPS = [
    { title: 'Housing metrics', items: [
      { key: 'resale', label: 'Resale Home (Median $)', fmt: 'usd0', good: 'down', url: fred('HOSMEDUSM052N') },
      { key: 'newConstruction', label: 'New Construction (Median $)', fmt: 'usd0', good: 'down', url: fred('MSPNHSUS') },
      { key: 'affordableHome', label: 'Affordable Home (Median $)', fmt: 'usd0', good: 'down', url: NAR_FTHB_Q3 },
    ] },
    { title: 'Mortgage', items: [
      { key: 'mortgageRate', label: 'Mortgage Rate', fmt: 'pct2', good: 'down', url: fred('MORTGAGE30US') },
      { key: 'fedRate', label: 'Fed Rate', fmt: 'pct2', good: 'down', url: fred('FEDFUNDS') },
      { key: 'treasury10y', label: '10 Year Treasury Yield', fmt: 'pct2', good: 'down', url: fred('DGS10') },
      { key: 'coreInflation', label: 'Core Inflation Y.O.Y.', fmt: 'pct2', good: 'down', url: fred('CORESTICKM159SFRBATL') },
      { key: 'medianMortgage', label: 'Median Mortgage p/month*', fmt: 'usd0', good: 'down', url: 'https://www.mortgagenewsdaily.com/mortgage-calculator' },
    ] },
    { title: 'Affordability', items: [
      { key: 'fthb', label: 'FTHB Affordability Index', fmt: 'num1', good: 'up', url: NAR_FTHB },
      { key: 'hai', label: 'Housing Affordability Index', fmt: 'num1', good: 'up', url: fred('FIXHAI') },
      { key: 'income', label: 'Median Household Income', fmt: 'usd0', good: 'up', url: fred('MEHOINUSA672N') },
    ] },
    { title: 'Legislation', items: [
      { key: 'bills', label: 'Bills in Congress**', fmt: 'int', good: 'up', targetText: 'literally anything', url: 'https://legiscan.com/gaits/search?state=US&keyword=regulatory+housing' },
    ] },
    { title: 'Supply', items: [
      { key: 'totalForSale', label: 'Total Homes for Sale', fmt: 'int', good: 'up', url: fred('ACTLISCOUUS') },
      { key: 'newForSale', label: 'New Construction for Sale', fmt: 'int', good: 'up', url: fred('NHFSEPTS') },
      { key: 'resaleForSale', label: 'Resale Homes for Sale', fmt: 'int', good: 'up', derived: true },
      { key: 'permits', label: 'Building Permits', fmt: 'int', good: 'up', url: fred('PERMIT') },
    ] },
  ];

  TT.KPI_NOTES = [
    '* $2,000 in home insurance and $2,000 in property taxes are escrowed into this payment. 30-year term with 10% down, no HOA or PMI. Based on “Resale Home (Median $)”.',
    '** Tracks “Regulatory Costs”, “Zoning Laws”, “Impact Fee Structure” and first-time-home-buyer related legislation.',
  ];

  // Crash-likelihood variables. Each rule is [operator, threshold, points],
  // checked in order; `otherwise` applies when none match. Copied from the
  // IFS() formulas in column E of the TRUMP TRACKER tab.
  TT.CRASH_VARS = [
    { key: 'unemployment', label: 'Unemployment Rate', category: 'Critical', fmt: 'pct1', url: fred('UNRATE'),
      rules: [['<', 0.04, 0], ['<', 0.06, 3], ['<', 0.08, 6], ['<', 0.1, 9]], otherwise: 12 },
    { key: 'fhaDelinquency', label: 'FHA Mortgage Delinquency Rate', category: 'Critical', fmt: 'pct2',
      url: 'https://www.mba.org/news-and-research/newsroom/news/2025/02/06/mortgage-delinquencies-increase-in-the-fourth-quarter-of-2024',
      rules: [['<', 0.05, 0], ['<', 0.1, 3], ['<', 0.13, 6], ['<', 0.15, 9]], otherwise: 12 },
    { key: 'mortgageDelinquency', label: 'Total Mortgage Delinquency Rate', category: 'Critical', fmt: 'pct2', url: fred('DRSFRMACBS'),
      rules: [['<', 0.02, 0], ['<', 0.05, 5], ['<', 0.1, 10]], otherwise: 15 },
    { key: 'housingSupply', label: 'Total Housing Supply', category: 'Critical', fmt: 'int', url: fred('ACTLISCOUUS'),
      rules: [['>', 0.6, 0], ['>', 0.45, 3], ['>', 0.3, 6], ['>', 0.15, 9]], otherwise: 12,
      note: 'As in the source sheet, the thresholds are ratios but the input is a listing count, so this always scores 0.' },
    { key: 'disposableIncome', label: 'Disposable Income of Homeowners', category: 'Major', fmt: 'pct2', url: fred('TDSP'),
      rules: [['>', 0.13, 0], ['>', 0.11, 2], ['>', 0.09, 4], ['>', 0.07, 6]], otherwise: 8 },
    { key: 'foreclosure', label: 'Foreclosure Rate', category: 'Major', fmt: 'pct2', url: fred('RCMFLBBALDPDPCT90P'),
      rules: [['<', 0.005, 0], ['<', 0.01, 2], ['<', 0.02, 4], ['<', 0.03, 6]], otherwise: 8 },
    { key: 'businessDelinquency', label: 'Business Loan Delinquencies', category: 'Major', fmt: 'pct2', url: fred('DRBLACBS'),
      rules: [['<', 0.01, 0], ['<', 0.015, 2], ['<', 0.02, 4], ['<', 0.03, 6]], otherwise: 8 },
    { key: 'allLoansDelinquency', label: 'Delinquency Rate on All Loans', category: 'Major', fmt: 'pct2', url: fred('DRALACBN'),
      rules: [['<', 0.015, 0], ['<', 0.025, 2], ['<', 0.04, 4], ['<', 0.06, 6]], otherwise: 8 },
    { key: 'creditCard', label: 'Credit Card Delinquencies', category: 'Minor', fmt: 'pct2', url: fred('DRCCLACBS'),
      rules: [['<', 0.02, 0], ['<', 0.03, 1.5], ['<', 0.04, 3.25], ['<', 0.05, 5]], otherwise: 6.25 },
    { key: 'autoSubprime', label: 'Car Payment Defaults (subprime)', category: 'Minor', fmt: 'pct2',
      url: 'https://www.fitchratings.com/structured-finance/abs/auto-indices',
      rules: [['<', 0.03, 0], ['<', 0.06, 3], ['<', 0.1, 6]], otherwise: 9 },
    { key: 'rentalVacancy', label: 'Rental Vacancy Rate', category: 'Minor', fmt: 'pct1', url: fred('RRVRUSQ156N'),
      rules: [['<', 0.06, 0], ['<', 0.07, 1.5], ['<', 0.08, 3.25], ['<', 0.09, 5]], otherwise: 6.25 },
    { key: 'yieldCurve', label: 'Backdated Yield Curve (12 month)', category: 'Critical', fmt: 'pct2', url: fred('T10Y2Y'),
      rules: [['>', 0.01, 0], ['>', 0, 3], ['>', -0.5, 6], ['>', -1, 9]], otherwise: 12,
      note: 'As in the source sheet, the value is a decimal (0.31% = 0.0031) but the lower thresholds are −0.5 and −1, so the top tiers only trigger on an extreme inversion.' },
    { key: 'jobOpenings', label: 'Job Openings (JOLTS)', category: 'Major', fmt: 'int', url: fred('JTSJOL'),
      rules: [['>', 9000000, 0], ['>', 7500000, 2], ['>', 6000000, 4], ['>', 5000000, 6]], otherwise: 8 },
    { key: 'layoffs', label: 'Layoffs', category: 'Major', fmt: 'int', url: fred('JTSLDL'),
      rules: [['<', 1500000, 0], ['<', 2000000, 3], ['<', 2250000, 6], ['<', 2500000, 9]], otherwise: 12 },
    { key: 'bankPlumbing', label: 'Bank Plumbing (SOFR - IORB)', category: 'Critical', fmt: 'pct2', url: fred('SOFR30DAYAVG'),
      rules: [['<=', 0, 0], ['<', 0.001, 3], ['<', 0.0025, 6], ['<', 0.005, 9]], otherwise: 12 },
    { key: 'cashDeposits', label: 'Cash Deposits', category: 'Major', fmt: 'usdB', url: fred('DPSACBW027SBOG'),
      rules: [['>=', 18500, 0], ['>=', 18000, 3], ['>=', 17500, 6], ['>=', 17000, 9]], otherwise: 12 },
    { key: 'u6', label: 'U6 Unemployment Rate', category: 'Critical', fmt: 'pct1', url: fred('U6RATE'),
      rules: [['<=', 0.07, 0], ['<=', 0.095, 3], ['<', 0.1, 6], ['<', 0.15, 9]], otherwise: 12 },
    { key: 'tempWorkers', label: 'Temporary Workers', category: 'Major', fmt: 'int', url: fred('TEMPHELPS'),
      rules: [['>=', 2800000, 0], ['>=', 2500000, 3], ['>=', 2250000, 6], ['>=', 2000000, 9]], otherwise: 12 },
    { key: 'initialClaims', label: 'Initial Job Loss Claims', match: 'Inital Job Loss Claims', category: 'Minor', fmt: 'int', url: fred('ICSA'),
      rules: [['<=', 225000, 0], ['<=', 250000, 3], ['<=', 335000, 6], ['<=', 425000, 9]], otherwise: 12 },
    { key: 'standingRepo', label: 'Standing Repo Usage', match: 'Standing Repo Usage (in $ billions)', category: 'Minor', fmt: 'usdB', url: fred('RPONTSYD'),
      rules: [['=', 0, 0], ['<', 100, 3], ['<', 250, 6], ['<', 500, 9]], otherwise: 12 },
  ];

  // Cost trackers. `col` is the sheet block (P = builder + household pt 1,
  // W = household pt 2 and 3). fmt 'price' = dollars, 'index' = CPI/PPI level.
  const cost = (col, group, key, label, fmt, series, extra) =>
    Object.assign({ col, group, key, label, fmt, url: series ? (series.startsWith('http') ? series : fred(series)) : null }, extra);
  TT.COST_ITEMS = [
    cost('P', 'builder', 'lumber', 'Softwood Lumber', 'index', 'WPU0811'),
    cost('P', 'builder', 'steel', 'Steel', 'index', 'WPU10170674'),
    cost('P', 'builder', 'shingles', 'Shingles', 'index', 'PCU3241223241222'),
    cost('P', 'builder', 'plumbing', 'Plumbing', 'index', 'PCU3329133329136'),
    cost('P', 'builder', 'concrete', 'Concrete', 'index', 'PCU32733273'),
    cost('P', 'household', 'power', 'Power (per KWH)', 'price', 'APU000072610'),
    cost('P', 'household', 'milk', 'Milk', 'price', 'APU0000709112'),
    cost('P', 'household', 'eggs', 'Eggs', 'price', 'APU0000708111'),
    cost('P', 'household', 'bread', 'Bread', 'price', 'APU0000702111'),
    cost('P', 'household', 'chicken', 'Boneless Chicken', 'price', 'APU0000FF1101'),
    cost('P', 'household', 'gas', 'Gallon of Gas', 'price', 'APU000074714'),
    cost('P', 'household', 'homeInsurance', 'Home Insurance', 'index', 'PCU9241269241262'),
    cost('P', 'household', 'carInsurance', 'Car Insurance', 'index', 'PCU9241269241261'),
    cost('P', 'household', 'medical', 'Medical Care', 'index', 'CPIMEDSL'),
    cost('W', 'household', 'food', 'Food Overall', 'index', 'CPIUFDSL'),
    cost('W', 'household', 'doorsWindows', 'Doors/Windows', 'index', 'PCU3323213323211'),
    cost('W', 'household', 'hvac', 'HVAC System', 'index', 'PCU3334133341'),
    cost('W', 'household', 'fridge', 'Fridge', 'index', 'WPU12410329'),
    cost('W', 'household', 'waterHeater', 'Water Heater', 'index', 'WPU106601'),
    cost('W', 'household', 'beef', 'Beef', 'price', 'APU0000703112'),
    cost('W', 'household', 'coffee', 'Coffee', 'price', 'APU0000717311'),
    cost('W', 'household', 'carParts', 'Car Parts', 'index', null),
    cost('W', 'household', 'childcare', 'Childcare/education', 'index', 'CUSR0000SEEB'),
    cost('W', 'household', 'clothing', 'Clothing', 'index', 'WPS583'),
    cost('W', 'household', 'usedCar', 'Used Car', 'index', 'CUSR0000SETA02'),
    cost('W', 'household', 'healthInsurance', 'Health Insurance', 'index', 'WPS411103'),
    cost('W', 'household', 'rent', 'Rent', 'index', 'CUSR0000SEHA'),
    cost('W', 'household', 'naturalGas', 'Natural Gas Heat', 'price', 'APU000072620'),
    cost('W', 'household', 'sewer', 'Sewer', 'index', 'CUSR0000SEHG'),
    cost('W', 'household', 'transit', 'Public Transit Fees', 'index', 'CUUR0000SETG'),
    cost('W', 'household', 'furniture', 'Furniture', 'index', 'CUUR0000SAH3'),
    cost('W', 'household', 'cleaning', 'Cleaning supplies', 'index', 'CUUS0000SEHN'),
    cost('W', 'household', 'streaming', 'Streaming / Cable TV', 'index', 'CUSR0000SERA02'),
    cost('W', 'household', 'internet', 'Internet', 'index', 'CUSR0000SEEE'),
    cost('W', 'household', 'foodAway', 'Food away from home', 'index', 'CUSR0000SEFV'),
    cost('W', 'household', 'personalCare', 'Personal Care', 'index', 'CUUR0000SEGC'),
    cost('W', 'household', 'rice', 'Rice per lb', 'price', 'APU0000701312'),
    cost('W', 'household', 'flour', 'Flour per lb', 'price', 'APU0000701111'),
    cost('W', 'household', 'sugar', 'Sugar per lb', 'price', 'APU0000715211'),
    cost('W', 'household', 'tomatoes', 'Tomatoes per lb', 'price', null),
    cost('W', 'household', 'bananas', 'Bananas per lb', 'price', 'APU0000711211'),
    cost('W', 'household', 'potatoes', 'Potatoes per lb', 'price', null),
    cost('W', 'household', 'lettuce', 'Lettuce per lb', 'price', 'APU0000FL2101'),
    cost('W', 'household', 'cheddar', 'Cheddar Cheese per lb', 'price', 'APU0000710212'),
    cost('W', 'household', 'bacon', 'Bacon per lb', 'price', 'APU0000704111'),
    cost('W', 'household', 'chips', 'Potato Chips', 'price', 'APU0000718311'),
    cost('W', 'household', 'diapers', 'Disposable Diapers', 'index', 'PCU3222913222912'),
    cost('W', 'household', 'oranges', 'Oranges per lb', 'price', 'APU0000711311'),
    cost('W', 'household', 'toiletPaper', 'Toilet Paper', 'index', 'WPU091501235'),
    cost('W', 'household', 'trash', 'Trash collection', 'index', null),
    cost('W', 'household', 'cereal', 'Cereal', 'index', 'CUSR0000SAF111'),
    cost('W', 'household', 'firstAid', 'First Aid Supplies', 'index', 'WPS156'),
    cost('W', 'household', 'cookingOil', 'Cooking Oil', 'index', 'WPU02780115'),
    cost('W', 'household', 'saltPepper', 'Salt & Pepper', 'index', 'WPU02890156'),
    cost('W', 'household', 'tea', 'Tea', 'index', 'PCU3119203119207'),
    cost('W', 'household', 'wine', 'Wine', 'price', 'APU0000720311'),
    cost('W', 'household', 'dental', 'Dental Care', 'index', 'WPU511105'),
    cost('W', 'household', 'energyDrinks', 'Energy Drinks', 'index', 'PCU312111312111B'),
    cost('W', 'household', 'insulin', 'Insulin', 'index', 'WPU06380103'),
    cost('W', 'household', 'diesel', 'Diesel Gas', 'price', null),
    cost('W', 'household', 'kitchenAppliances', 'Kitchen Appliances', 'index', 'WPU12410105'),
    cost('W', 'household', 'petFood', 'Pet Food', 'index', 'CUUR0000SS61031'),
    cost('W', 'household', 'computer', 'Computer', 'index', 'PCU334334'),
    cost('W', 'household', 'lawnCare', 'Lawn care', 'index', 'PCU3331123331127'),
  ];

  TT.PROMISES = [
    { match: 'Total Homes Built', fmt: 'int', url: fred('PERMIT') },
    { match: 'Regulatory Costs Cut', fmt: 'usd0', url: 'https://www.nahb.org/news-and-economics/press-releases/2026/06/regulatory-costs-jump-40-in-five-years-add-131734-to-new-home-prices' },
    { match: 'Fix Unaffordability', fmt: 'usd0', url: fred('HOSMEDUSM052N') },
    { match: 'Lower Mortgage Rates', fmt: 'pct2', url: fred('MORTGAGE30US') },
    { match: 'Home Buying Programs', fmt: 'text', url: null },
  ];

  TT.REGIONS = [
    { key: 'ne', label: 'Northeast', col: 'B' },
    { key: 'mw', label: 'Midwest', col: 'C' },
    { key: 's', label: 'South', col: 'D' },
    { key: 'w', label: 'West', col: 'E' },
  ];
  TT.REGION_ROWS = [
    { key: 'resale', label: 'Resale Home (Median $)', fmt: 'usd0' },
    { key: 'qualifyingIncome', label: 'Median Qualifying Income', fmt: 'usd0' },
    { key: 'familyIncome', label: 'Median Family Income', fmt: 'usd0' },
    { key: 'mortgage', label: 'Median Mortgage (P&I)', fmt: 'usd0' },
    { key: 'today', label: 'Affordability today', fmt: 'num1' },
    { key: 'monthPrior', label: 'Month prior', match: 'month prior', fmt: 'num1' },
    { key: 'lastYear', label: 'Last year', match: 'last year', fmt: 'num1' },
  ];
  TT.REGION_URL = NAR_HAI;
  TT.REGION_SOURCE_URL = NAR_REGION;

  // Household budget assumptions ("Affordability Index" tab, column H/I).
  TT.BUDGET_INPUTS = [
    { key: 'downPct', label: 'Down Payment %', fmt: 'pct0' },
    { key: 'termYears', label: 'Mortgage Term (years)', fmt: 'num0' },
    { key: 'taxRate', label: 'Effective Tax Rate', fmt: 'pct0' },
    { key: 'food', label: 'Base Food $/mo', fmt: 'usd0' },
    { key: 'carPayment', label: 'Base Used Car Payment $/car/mo', fmt: 'usd0' },
    { key: 'studentLoan', label: 'Base Student Loan $/mo', fmt: 'usd0' },
    { key: 'childcare', label: 'Base Childcare $/mo (1 kid)', fmt: 'usd0' },
    { key: 'electric', label: 'Base Electric $/mo', fmt: 'usd0' },
    { key: 'healthcare', label: 'Base Family Healthcare $/mo', fmt: 'usd0' },
    { key: 'autoInsurance', label: 'Base Auto Insurance $/mo', fmt: 'usd0' },
    { key: 'tanks', label: 'Gas Tanks per Month (family)', fmt: 'num1' },
    { key: 'gallons', label: 'Gallons per Tank', fmt: 'num0' },
    { key: 'phone', label: 'Base Phone $/mo', fmt: 'usd0' },
    { key: 'internet', label: 'Base Internet $/mo', fmt: 'usd0' },
  ];

  // Score tiers: [lower bound, label, tone]. Checked top to bottom, as in the
  // sheet's IFS() formulas.
  TT.TIERS = {
    supply: [[90, 'Balanced', 'good'], [70, 'Slight Undersupply', 'watch'], [45, 'Tight Market', 'warn'], [-Infinity, 'Critical Shortage', 'bad']],
    affordability: [[80, 'Affordable', 'good'], [60, 'Pressured', 'watch'], [40, 'Very Strained', 'warn'], [-Infinity, 'Meltdown', 'bad']],
    crash: [[100, 'MELTDOWN', 'bad'], [80, 'Crash in Sight', 'warn'], [70, 'Correction in Sight', 'watch'], [50, 'Starting to Stall', 'watch'], [-Infinity, 'Nowhere Close', 'good']],
    health: [[85, 'Affordable Housing', 'good'], [72.5, 'Buyer’s Market', 'watch'], [60, 'Neutral Market', 'warn'], [50, 'Affordability Crisis', 'bad'], [40, 'Nowhere close to affordable', 'bad'], [-Infinity, 'Crisis Mode', 'crisis']],
    crashItem: [[10, 'High Risk', 'bad'], [6, 'Elevated Risk', 'warn'], [3, 'Moderate Risk', 'watch'], [-Infinity, 'Low Risk', 'good']],
  };

  TT.RESOURCES = [
    { label: 'Agenda 47', url: 'https://www.donaldjtrump.com/agenda47' },
    { label: 'Everything Trump has done so far to affect housing (HousingWire)', url: 'https://www.housingwire.com/articles/updated-list-of-all-trumps-actions-that-impact-housing/' },
    { label: 'Latest on Housing & Urban Development', url: 'https://www.hud.gov/press/press_releases_media_advisories' },
    { label: 'Project 2025 Tracker (projected housing-related changes)', url: 'https://www.project2025.observer/?agencies=Housing+and+Urban+Development' },
    { label: 'Monthly email updates (sign-up form)', url: 'https://docs.google.com/forms/d/e/1FAIpQLSey0UG5Fiw_3d3iZXHCgjKSW5d7V_zfBG0uaXBHaBWDdf0D1g/viewform?usp=header' },
  ];
})(window.TT = window.TT || {});
