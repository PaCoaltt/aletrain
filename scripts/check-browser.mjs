// Local browser regression check. Timetables/rail routes are fixtures, never production.
// Usage: node scripts/check-browser.mjs /path/to/playwright/index.mjs [--live-tiles]
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { translate } from '../i18n.js';
import { swissDateTime } from '../adventure.js';

const { chromium } = await import(process.argv[2] ? pathToFileURL(resolve(process.argv[2])).href : 'playwright');
const liveTiles = process.argv.includes('--live-tiles');
const directory = await mkdtemp(join(tmpdir(), 'aletrain-browser-'));
await mkdir('.audit', { recursive: true });
const metrics = join(directory, 'visits.json');
await writeFile(metrics, '{"visits":37}');
const reserve = createServer();
await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
const port = reserve.address().port;
await new Promise(resolve => reserve.close(resolve));
const child = spawn(process.execPath, ['server.mjs'], {
  env: { ...process.env, PORT: String(port), VISITS_FILE: metrics, REQUIRE_VISITS_FILE: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
});
let browser;
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server startup timeout')), 5000);
    child.once('error', reject);
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exit ${code}`)); });
    child.stdout.once('data', () => { clearTimeout(timer); resolve(); });
  });
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ locale: 'fr-CH', viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const base = Math.floor(Date.now() / 60000) * 60000;
  const at = minute => new Date(base + minute * 60000).toISOString();
  const origin = { id: '8501120', name: 'Lausanne', coordinate: { x: 46.5168, y: 6.6291 } };
  const destination = { id: 'A', name: 'Morges', coordinate: { x: 46.511, y: 6.498 } };
  const journey = { category: 'IR', number: '90', to: 'Genève', stop: { station: origin, departure: at(10), platform: '1',
    delay: 2, prognosis: { departure: at(12), platform: '3' } },
    passList: [{ station: origin }, { station: destination, arrival: at(30), prognosis: { arrival: at(32) } }] };
  await page.route('https://transport.opendata.ch/**', route => {
    const path = new URL(route.request().url()).pathname;
    const data = path.endsWith('/locations') ? { stations: [origin] }
      : path.endsWith('/stationboard') ? { stationboard: [journey] }
      : { connections: [{ from: { station: destination, departure: at(80) }, to: { station: origin, arrival: at(120) }, transfers: 0,
        sections: [{ journey: { category: 'IR', number: '90' }, departure: { station: destination, departure: at(80) }, arrival: { station: origin, arrival: at(120) } }] }] };
    return route.fulfill({ json: data });
  });
  await page.route('**/api/rail-route', async route => {
    const { points } = route.request().postDataJSON();
    await route.fulfill({ json: { lines: points.slice(1).map((point, index) => [points[index], point]), source: 'OpenStreetMap', approximate: true } });
  });
  if (!liveTiles) await page.route('https://tile.openstreetmap.org/**', route => route.fulfill({ contentType: 'image/png',
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=', 'base64') }));
  await page.goto(`http://127.0.0.1:${port}`);
  await page.locator('.leaflet-tile-loaded').first().waitFor({ timeout: 12000 });
  await page.waitForFunction(() => document.querySelector('#visitCount').dataset.visits === '38');
  assert.equal(await page.locator('.leaflet-control-zoom').count(), 1);
  const naturalWidth = await page.locator('.leaflet-tile-loaded').first().evaluate(image => image.naturalWidth);
  assert.equal(naturalWidth, liveTiles ? 256 : 1);
  assert.ok((await page.locator('#map').boundingBox()).height > 300);
  for (const lang of ['fr', 'de', 'gsw', 'it', 'en']) {
    await page.selectOption('#languageSelect', lang);
    assert.equal(await page.getAttribute('html', 'lang'), lang);
    assert.equal((await page.locator('#drawPlatformButton').innerText()).replace(/\s+/g, ' '), translate(lang, 'draw.transport') + ' →');
    assert.equal(await page.locator('#visitCount').innerText(), translate(lang, 'visits.other', { count: 38 }));
  }
  await page.selectOption('#languageSelect', 'gsw');
  await page.reload();
  await page.waitForFunction(() => document.documentElement.lang === 'gsw' && document.querySelector('#visitCount').dataset.visits === '38');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.querySelector('#map').getBoundingClientRect().width < 400);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'mobile horizontal overflow');
  assert.ok((await page.locator('#map').boundingBox()).height >= 330);
  await page.waitForFunction(() => [...document.querySelectorAll('.leaflet-tile-loaded')].some(tile => Number(getComputedStyle(tile).opacity) === 1));
  await page.screenshot({ path: resolve(`.audit/mobile-gsw-${liveTiles ? 'live' : 'fixture'}-${Date.now()}.png`), fullPage: true });
  await page.selectOption('#languageSelect', 'fr');
  await page.fill('#durationInput', '60');
  await page.click('.return-options summary');
  const limit = swissDateTime(base + 180 * 60000);
  await page.fill('#returnInput', `${limit.date}T${limit.time}`);
  await page.fill('#stationInput', 'Lausanne');
  await page.click('#stationSearch button');
  await page.waitForFunction(() => document.querySelector('#stationName').textContent === 'Lausanne');
  await page.click('#drawPlatformButton');
  await page.locator('#trainResult').filter({ hasText: 'IR 90' }).waitFor();
  await page.click('#drawStopsButton');
  await page.locator('.return-summary').waitFor();
  assert.ok(await page.locator('.exit-marker').count());
  assert.ok(await page.locator('.leaflet-overlay-pane path').count());
  assert.equal((await (await page.request.get(`http://127.0.0.1:${port}/api/visits`)).json()).visits, 38);
  await page.clock.install();
  await page.clock.fastForward(31000);
  assert.equal((await (await page.request.get(`http://127.0.0.1:${port}/api/visits`)).json()).visits, 38);
  assert.deepEqual(errors, [], 'unexpected JavaScript errors');
  await page.screenshot({ path: join(directory, 'mobile.png'), fullPage: true });
  // Fail the optional shared dependency: real visits must still be recorded.
  const broken = await context.newPage();
  await broken.route('**/i18n.js?v=5', route => route.abort());
  await broken.goto(`http://127.0.0.1:${port}`);
  await broken.waitForFunction(() => document.querySelector('#visitCount').dataset.visits === '38');
  await broken.locator('#mapStatus').waitFor({ state: 'visible' });
  // Explicit map error for failed tile requests, while the main app still boots.
  const blocked = await context.newPage();
  await blocked.route('https://tile.openstreetmap.org/**', route => route.abort());
  await blocked.goto(`http://127.0.0.1:${port}`);
  await blocked.locator('#mapStatus').waitFor({ state: 'visible' });
  console.log(JSON.stringify({ result: 'passed', browser: await browser.version(), tileMode: liveTiles ? 'real OpenStreetMap' : 'fixture PNG',
    checked: ['Leaflet CSS/JS, tile images and zoom', 'five languages and persistence', 'real counter and reload deduplication', '390px mobile layout', 'station search and departures (fixtures)', 'draw, railway path, markers and return (fixtures)', 'automatic refresh does not count visits', 'i18n failure isolation', 'explicit tile error'] }));
} finally {
  if (browser) await browser.close();
  if (child.exitCode === null) { const stopped = once(child, 'exit'); child.kill(); await stopped; }
  await rm(directory, { recursive: true, force: true });
}
