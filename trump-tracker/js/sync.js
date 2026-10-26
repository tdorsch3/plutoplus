// Pulls fresh numbers from the public Google Sheet. Uses the gviz endpoint's
// JSONP mode (a <script> tag) so it also works when index.html is opened
// straight from disk, where fetch() would be blocked by CORS.
(function (TT) {
  const SOURCE = window.TRACKER_SOURCE;
  let seq = 0;

  function gvizQuery(sheet, range, timeoutMs) {
    return new Promise((resolve, reject) => {
      const cb = `__ttGviz_${Date.now().toString(36)}_${++seq}`;
      const script = document.createElement('script');
      const timer = setTimeout(() => finish(new Error('timed out')), timeoutMs);
      function finish(err, data) {
        clearTimeout(timer);
        window[cb] = function () {}; // a late response must not throw
        script.remove();
        if (err) return reject(err);
        if (!data || data.status !== 'ok') {
          const detail = data && data.errors && data.errors[0] && (data.errors[0].detailed_message || data.errors[0].message);
          return reject(new Error(detail || 'the sheet returned an error'));
        }
        resolve(data);
      }
      window[cb] = (data) => finish(null, data);
      script.onerror = () => finish(new Error('network error'));
      const params = new URLSearchParams({ tqx: `out:json;responseHandler:${cb}`, headers: '0', sheet, range });
      script.src = `https://docs.google.com/spreadsheets/d/${SOURCE.sheetId}/gviz/tq?${params}`;
      document.head.appendChild(script);
    });
  }

  // Resolves to { fetchedAt, responses } in the same shape as data/snapshot.js.
  TT.syncFromSheet = async function (timeoutMs = 20000) {
    const entries = Object.entries(SOURCE.queries);
    const results = await Promise.all(entries.map(([name, q]) =>
      gvizQuery(q.sheet, q.range, timeoutMs).catch((err) => { throw new Error(`${q.sheet}!${q.range}: ${err.message}`); })));
    const responses = {};
    entries.forEach(([name], i) => { responses[name] = results[i]; });
    return { fetchedAt: new Date().toISOString(), responses };
  };
})(window.TT = window.TT || {});
