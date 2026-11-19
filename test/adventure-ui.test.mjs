import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as adventure from '../adventure.js';
import * as i18n from '../i18n.js';

async function appFixture({ failBoard = false, lateReturn = false } = {}) {
  const nodes = new Map();
  const node = key => {
    if (!nodes.has(key)) nodes.set(key, {
      value: '', textContent: '', innerHTML: '', disabled: false, hidden: false, dataset: {},
      classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, focus() {},
      querySelector: suffix => node(`${key} ${suffix}`),
    });
    return nodes.get(key);
  };
  const now = Math.floor(Date.now() / 60000) * 60000;
  const at = minutes => new Date(now + minutes * 60000).toISOString();
  const station = { id: 'origin', name: 'Lausanne' };
  const journey = { category: 'IR', number: '90', to: 'Destination',
    stop: { station, departure: at(8), platform: '1', prognosis: { departure: at(10), platform: '3' } },
    passList: [{ station }, { station: { id: 'A', name: 'Arrêt A' }, arrival: at(30) },
      { station: { id: 'B', name: 'Arrêt B' }, arrival: at(40) }] };
  const calls = [], events = [];
  let nextBoardResponse;
  const fetch = async input => {
    const url = new URL(input, 'http://localhost');
    calls.push(url);
    if (url.pathname === '/v1/stationboard') {
      if (nextBoardResponse) {
        const response = nextBoardResponse;
        nextBoardResponse = null;
        return response;
      }
      if (failBoard) throw new Error('Offline');
      return { ok: true, json: async () => ({ stationboard: [journey, { ...journey, cancelled: true }] }) };
    }
    if (url.pathname === '/v1/connections') return { ok: true, json: async () => ({ connections: [{
      from: { station: { name: 'Arrêt' }, departure: at(80) },
      to: { station, arrival: at(lateReturn ? 240 : 120) }, transfers: 0,
      sections: [{ journey: { category: 'IR', number: '90' }, departure: { station: { name: 'Arrêt' }, departure: at(80) }, arrival: { station, arrival: at(120) } }],
    }] }) };
    throw new Error(`Unexpected API call: ${url.pathname}`);
  };
  const context = vm.createContext({ ...i18n, ...adventure, URL, AbortSignal, Date, Intl, Map, Set, fetch,
    localStorage: { getItem: () => { throw new Error('Legacy account storage must not be read'); } },
    document: { querySelector: node, body: node('body'), addEventListener() {} },
    window: { addEventListener() {}, setInterval() {}, clearTimeout() {}, dispatchEvent: event => events.push(event) },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
  });
  const source = (await readFile(new URL('../app.js', import.meta.url), 'utf8'))
    .replace(/^import .*\r?\n/gm, '').replace(/\ninitMap\(\);/, '\n');
  vm.runInContext(`${source}\nupdateMap = () => {}; drawJourneyRoute = () => {};\n` +
    'globalThis.app = { state, drawPlatformAndTrain, drawStops, resetDraws, refreshBoard, contextDocument: document };', context);
  node('#durationInput').value = '60';
  node('#waitInput').value = '45';
  node('#adventureInput').value = 'all';
  node('#stayInput').value = '30';
  const deadline = adventure.swissDateTime(now + 180 * 60000);
  node('#returnInput').value = `${deadline.date}T${deadline.time}`;
  context.app.state.station = station;
  const deferBoard = () => {
    let releaseBoard;
    nextBoardResponse = new Promise(release => {
      releaseBoard = board => release({ ok: true, json: async () => ({ stationboard: board }) });
    });
    return releaseBoard;
  };
  return { ...context.app, node, calls, events, journey, deferBoard };
}

test('draw refreshes departures, selects the updated platform and confirms a feasible return', async () => {
  const app = await appFixture();
  await app.drawPlatformAndTrain();
  assert.equal(app.state.selectedPlatform, '3');
  assert.equal(app.state.selectedJourney.cancelled, undefined);
  assert.match(app.node('#trainResult').innerHTML, /Prévision reçue/);
  assert.deepEqual(app.calls.find(url => url.pathname.endsWith('stationboard')).searchParams.getAll('transportations[]'), adventure.ADVENTURES.all);
  await app.drawStops();
  assert.match(app.node('#stopsPreview').innerHTML, /Retour vers Lausanne/);
  assert.equal(app.events.filter(event => event.detail?.name).length, 1);
  assert.equal(app.state.busy, false);
});

test('a late return never confirms a destination and an unavailable board never draws a trip', async () => {
  const app = await appFixture({ lateReturn: true });
  await app.drawPlatformAndTrain();
  await app.drawStops();
  assert.equal(app.events.filter(event => event.detail?.name).length, 0);
  assert.match(app.node('#stopsPreview').textContent, /non confirmé/);
  assert.equal(app.calls.filter(url => url.pathname.endsWith('connections')).length, 2);
  const offline = await appFixture({ failBoard: true });
  await offline.drawPlatformAndTrain();
  assert.equal(offline.state.selectedJourney, null);
  assert.equal(offline.node('#drawStopsButton').disabled, true);
});

test('expired departure data keeps the result and requires a new transport draw', async () => {
  const app = await appFixture();
  await app.drawPlatformAndTrain();
  app.state.boardLoadedAt = Date.now() - 61000;
  await app.drawStops();
  assert.ok(app.state.selectedJourney);
  assert.equal(app.calls.filter(url => url.pathname.endsWith('connections')).length, 0);
  assert.equal(app.node('#drawRecheck').hidden, false);
});

test('refresh updates departures and preserves criteria and both draw results', async () => {
  const app = await appFixture();
  await app.drawPlatformAndTrain();
  const selected = app.state.selectedJourney;
  assert.equal(app.node('#drawStopsButton').disabled, false);
  const draw = app.drawStops();
  assert.equal(app.state.busy, true);
  const boardBeforeRefresh = app.state.stationboard;
  await app.refreshBoard();
  assert.notEqual(app.state.stationboard, boardBeforeRefresh);
  await draw;
  const train = app.node('#trainResult').innerHTML;
  const stops = app.node('#stopsPreview').innerHTML;
  const eventCount = app.events.length;
  const fields = ['#stationInput', '#durationInput', '#waitInput', '#adventureInput', '#returnInput', '#stayInput'];
  const release = app.deferBoard();
  const refresh = app.refreshBoard();
  app.node('#stationInput').value = 'Gen';
  const values = fields.map(field => app.node(field).value);
  release([{ ...selected, stop: { ...selected.stop, prognosis: { ...selected.stop.prognosis, platform: '9' } } }]);
  await refresh;
  assert.match(app.node('#departureList').innerHTML, /platform-badge">9</);
  assert.equal(app.state.selectedJourney, selected);
  assert.equal(app.state.selectedPlatform, '3');
  assert.deepEqual(fields.map(field => app.node(field).value), values);
  assert.equal(app.node('#trainResult').innerHTML, train);
  assert.equal(app.node('#stopsPreview').innerHTML, stops);
  assert.equal(app.events.length, eventCount);
  assert.equal(app.node('#drawStopsButton').disabled, true);
  assert.equal(app.node('#drawRecheck').hidden, false);
  await app.refreshBoard();
  assert.equal(app.node('#drawStopsButton').disabled, false);
  assert.equal(app.node('#drawRecheck').hidden, true);
});

test('a delayed refresh cannot overwrite the board used by a newer transport draw', async () => {
  const app = await appFixture();
  const release = app.deferBoard();
  const refresh = app.refreshBoard();
  await app.drawPlatformAndTrain();
  release([]);
  await refresh;
  assert.equal(app.state.stationboard.includes(app.state.selectedJourney), true);
  assert.equal(app.node('#drawStopsButton').disabled, false);
});

test('refresh skips hidden pages and prevents stale stop draws after an API failure', async () => {
  const hidden = await appFixture();
  hidden.contextDocument.hidden = true;
  await hidden.refreshBoard();
  assert.equal(hidden.calls.length, 0);
  const offline = await appFixture({ failBoard: true });
  await offline.refreshBoard();
  assert.equal(offline.state.refreshFailed, true);
  assert.equal(offline.node('#drawStopsButton').disabled, true);
});
