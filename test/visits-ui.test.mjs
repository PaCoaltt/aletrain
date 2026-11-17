import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { setText, t } from '../i18n.js';
import fr from '../locales/fr.js';

const source = (await readFile(new URL('../visit-counter.js', import.meta.url), 'utf8')).replace(/^import .*\r?\n/gm, '')
  .replace("import('./i18n.js?v=5')", 'Promise.resolve({setText, t})');

test('visit counter updates without loading the adventure app or map', async () => {
  const counter = { textContent: '0 visites', dataset: {} };
  const calls = [];
  await vm.runInNewContext(source, { Intl, AbortSignal, setText, t, fr,
    document: { querySelector: selector => selector === '#visitCount' ? counter : null },
    fetch: async (url, options) => {
      calls.push([url, options.method]);
      return { ok: true, json: async () => ({ visits: 42 }) };
    },
  });
  assert.equal(counter.textContent, '42 visites');
  assert.deepEqual(calls, [['/api/visits', 'POST']]);
});

test('blocked visit POST falls back to GET; unavailable API retains the server count', async () => {
  for (const getWorks of [true, false]) {
    const counter = { textContent: '7 visites', dataset: {} };
    let calls = 0;
    counter.dataset.visits = '7';
    await vm.runInNewContext(source, { Intl, AbortSignal, setText, t, fr,
      document: { querySelector: selector => selector === '#visitCount' ? counter : null },
      fetch: async () => ({ ok: ++calls === 2 && getWorks, json: async () => ({ visits: 8 }) }),
    });
    assert.equal(calls, 2);
    assert.equal(counter.textContent, getWorks ? '8 visites' : '7 visites');
  }
});

test('a static page with no working counter service gets an explicit fallback', async () => {
  const counter = { textContent: 'Visites : ...', dataset: {} };
  await vm.runInNewContext(source, { Intl, AbortSignal, setText, t, fr,
    document: { querySelector: selector => selector === '#visitCount' ? counter : null }, fetch: async () => { throw new Error('Offline'); },
  });
  assert.equal(counter.textContent, 'Compteur indisponible');
});
