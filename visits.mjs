import { readFile, writeFile, rename, mkdir, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname } from 'node:path';

export async function createVisitCounter(path, { requireExisting = false } = {}) {
  let total = 0;
  try {
    total = JSON.parse(await readFile(path, 'utf8')).visits;
    if (!Number.isSafeInteger(total) || total < 0) throw new Error('Compteur invalide');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (requireExisting) throw new Error(`Visit data is missing at ${path}. Restore or explicitly initialize it before starting; refusing to reset statistics.`);
  }
  await mkdir(dirname(path), { recursive: true });
  await access(dirname(path), constants.W_OK);
  let saved = total;
  let writeError = false;
  let writing = Promise.resolve();
  const flush = () => {
    writing = writing.catch(() => {}).then(async () => {
      if (saved === total) return;
      const snapshot = total;
      await writeFile(`${path}.tmp`, JSON.stringify({ visits: snapshot }));
      await rename(`${path}.tmp`, path);
      saved = snapshot;
      writeError = false;
    }).catch(error => { writeError = true; throw error; });
    return writing;
  };
  const timer = setInterval(() => flush().catch(error => console.warn('Visits:', error.message)), 30000);
  timer.unref();
  return {
    count: () => total,
    status: () => ({ storage: writeError ? 'error' : 'ok', pendingWrite: saved !== total }),
    visit: cookie => {
      if (!/(?:^|;\s*)aletrain_visit=1(?:;|$)/.test(cookie || '')) total++;
      return total;
    },
    flush,
    close: async () => { clearInterval(timer); await flush(); },
  };
}
