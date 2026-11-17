import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('HTTP counts visits, serves cached public assets and keeps private files inaccessible', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aletrain-http-'));
  const reserve = createServer();
  await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
  const port = reserve.address().port;
  await new Promise(resolve => reserve.close(resolve));
  const child = spawn(process.execPath, ['server.mjs'], {
    env: { ...process.env, PORT: String(port), VISITS_FILE: join(directory, 'visits.json') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Server startup timeout')), 5000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}`)); });
      child.stdout.once('data', () => { clearTimeout(timer); resolve(); });
    });
    const request = (path, options) => fetch(`http://127.0.0.1:${port}${path}`, options);
    const before = await request('/api/visits');
    assert.deepEqual(await before.json(), { visits: 0 });
    assert.equal((await request('/api/visits', { method: 'POST' })).status, 403);
    const first = await request('/api/visits', { method: 'POST', headers: { 'X-Aletrain-Visit': '1' } });
    assert.equal((await first.json()).visits, 1);
    assert.match(first.headers.get('set-cookie'), /aletrain_visit=1; Max-Age=1800/);
    const repeated = await Promise.all(Array.from({ length: 30 }, () => request('/api/visits', {
      method: 'POST', headers: { 'X-Aletrain-Visit': '1', Cookie: 'aletrain_visit=1' },
    }).then(response => response.json())));
    assert.ok(repeated.every(result => result.visits === 1));
    const home = await request('/');
    const html = await home.text();
    assert.match(html, /id="visitCount"[^>]*>1 visites<\/span>/);
    assert.doesNotMatch(html, /id="visitCount"[^>]*\bhidden\b|profileModal|reportModal|openProfileButton/);
    assert.match(html, /visit-counter.js\?v=3/);
    assert.equal(home.headers.get('cache-control'), 'no-store');
    for (const path of ['/api/profiles', '/api/sessions', '/api/reports', '/api/reports/example/confirm', '/api/telegram/webhook']) {
      for (const method of ['GET', 'POST']) assert.equal((await request(path, { method })).status, 404, `${method} ${path}`);
    }
    for (const path of ['/data.json', '/visits.json', '/server.mjs', '/.git/config', '/README.md']) {
      assert.equal((await request(path)).status, 404, path);
    }
    for (const path of ['/', '/app.js', '/visit-counter.js', '/adventure.js', '/activity-ui.js', '/activities-common.js', '/styles.css', '/vendor/leaflet/leaflet.js']) {
      const response = await request(path);
      assert.equal(response.status, 200, path);
      assert.ok(response.headers.get('cache-control'));
      if (path.endsWith('.js')) assert.match(response.headers.get('content-type'), /javascript/);
      assert.ok((await response.text()).length > 0);
    }
    const head = await request('/', { method: 'HEAD' });
    assert.equal(await head.text(), '');
    const oversized = await request('/api/activities', { method: 'POST', body: JSON.stringify({ padding: 'x'.repeat(70000) }) });
    assert.equal(oversized.status, 413);
  } finally {
    const stopped = once(child, 'exit');
    child.kill();
    await stopped;
    await rm(directory, { recursive: true, force: true });
  }
});
