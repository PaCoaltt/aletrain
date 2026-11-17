import fr from './locales/fr.js?v=5';
// Start counting without waiting for the i18n module's DOM initialization.
(async () => {
  const counter = document.querySelector('#visitCount');
  if (!counter) return;
  const status = document.querySelector('#visitStatus');
  let formatter = null, last = null, statusKey = null;
  const showStatus = key => {
    statusKey = key;
    if (!status) return;
    status.hidden = !key;
    if (!key) { delete status.dataset.i18n; status.textContent = ''; return; }
    if (formatter) formatter.setText(status, key);
    else status.textContent = fr[key];
  };
  const display = data => {
    if (!Number.isSafeInteger(data.visits) || data.visits < 0) throw new Error('Invalid visits');
    last = data.visits;
    counter.dataset.visits = String(last);
    if (formatter) formatter.setText(counter, 'visits.other', { count: last });
    else counter.textContent = fr[last === 1 ? 'visits.one' : 'visits.other'].replace('{count}', new Intl.NumberFormat('fr-CH').format(last));
    if (data.storage === 'error') showStatus('visit.storageError');
  };
  import('./i18n.js?v=5').then(module => {
    formatter = module;
    if (last !== null) display({ visits: last });
    if (statusKey) showStatus(statusKey);
  }).catch(error => { console.error('Visit translations failed', error); showStatus('visit.translationError'); });
  if (counter.dataset.visits !== undefined) {
    try { display({ visits: Number(counter.dataset.visits) }); }
    catch (error) { console.error('Invalid server visit value', error); showStatus('visit.unavailable'); }
  }
  try {
    const response = await fetch('/api/visits', {
      method: 'POST', headers: { 'X-Aletrain-Visit': '1' },
      cache: 'no-store', signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error('Visit request failed');
    display(await response.json());
  } catch (error) {
    console.error('Visit registration failed', error);
    try {
      const response = await fetch('/api/visits', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error('Counter unavailable');
      const data = await response.json();
      display(data);
      showStatus(data.storage === 'error' ? 'visit.storageError' : 'visit.recordError');
    } catch (readError) {
      console.error('Visit counter read failed', readError);
      // Keep the number rendered by Node. For a static/old server, show a clear fallback.
      if (last === null) counter.textContent = formatter ? formatter.t('visit.unavailable') : fr['visit.unavailable'];
      showStatus('visit.stale');
    }
  }
})();
