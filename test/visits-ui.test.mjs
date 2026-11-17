import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../visit-counter.js', import.meta.url), 'utf8');

test('visit counter updates without loading the adventure app or map', async () => {
  const counter = { textContent: '0 visites' };
  const calls = [];
  await vm.runInNewContext(source, { Intl, AbortSignal,
    document: { querySelector: () => counter },
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
    const counter = { textContent: '7 visites' };
    let calls = 0;
    await vm.runInNewContext(source, { Intl, AbortSignal,
      document: { querySelector: () => counter },
      fetch: async () => ({ ok: ++calls === 2 && getWorks, json: async () => ({ visits: 8 }) }),
    });
    assert.equal(calls, 2);
    assert.equal(counter.textContent, getWorks ? '8 visites' : '7 visites');
  }
});

test('a static page with no working counter service gets an explicit fallback', async () => {
  const counter = { textContent: 'Visites : ...' };
  await vm.runInNewContext(source, { Intl, AbortSignal,
    document: { querySelector: () => counter }, fetch: async () => { throw new Error('Offline'); },
  });
  assert.equal(counter.textContent, 'Compteur indisponible');
});
