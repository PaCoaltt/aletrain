import { readFile, writeFile, rename } from 'node:fs/promises';

export async function createVisitCounter(path) {
  let total = 0;
  try {
    total = JSON.parse(await readFile(path, 'utf8')).visits;
    if (!Number.isSafeInteger(total) || total < 0) throw new Error('Compteur invalide');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  let saved = total;
  let writing = Promise.resolve();
  const flush = () => {
    writing = writing.catch(() => {}).then(async () => {
      if (saved === total) return;
      const snapshot = total;
      await writeFile(`${path}.tmp`, JSON.stringify({ visits: snapshot }));
      await rename(`${path}.tmp`, path);
      saved = snapshot;
    });
    return writing;
  };
  const timer = setInterval(() => flush().catch(error => console.warn('Visits:', error.message)), 30000);
  timer.unref();
  return {
    count: () => total,
    visit: cookie => {
      if (!/(?:^|;\s*)aletrain_visit=1(?:;|$)/.test(cookie || '')) total++;
      return total;
    },
    flush,
    close: async () => { clearInterval(timer); await flush(); },
  };
}
