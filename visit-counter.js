// Independent of the map and adventure modules: their loading cannot hide visits.
(async () => {
  const counter = document.querySelector('#visitCount');
  if (!counter) return;
  const display = data => {
    if (!Number.isSafeInteger(data.visits) || data.visits < 0) throw new Error('Invalid visits');
    counter.textContent = `${new Intl.NumberFormat('fr-CH').format(data.visits)} visites`;
  };
  try {
    const response = await fetch('/api/visits', {
      method: 'POST', headers: { 'X-Aletrain-Visit': '1' },
      cache: 'no-store', signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error('Visit request failed');
    display(await response.json());
  } catch {
    try {
      const response = await fetch('/api/visits', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error('Counter unavailable');
      display(await response.json());
    } catch {
      // Keep the number rendered by Node. For a static/old server, show a clear fallback.
      if (!/\d/.test(counter.textContent)) counter.textContent = 'Compteur indisponible';
    }
  }
})();
