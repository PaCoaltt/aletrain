import { t, tx, px, plural, setText, setHtml, formatDate, dateHtml, applyTranslations } from './i18n.js?v=5';
import { ADVENTURES, stopTime, platformFor, cancelled, usableReturn, swissDateTime, swissTimestamp, delayMinutes, hasPrediction, findRandomJourney, journeyStopTimestamp } from './adventure.js?v=5';
const API_ROOT = "https://transport.opendata.ch/v1";
const SWISS_CENTER = [46.8182, 8.2275];
const railRouteRequests = new Map();

const state = {
  map: null,
  markers: [],
  routeLayer: null,
  exitMarker: null,
  activityMarker: null,
  drawTimer: null,
  station: null,
  stationboard: [],
  platforms: new Map(),
  selectedJourney: null,
  selectedPlatform: null,
  selectedStop: null,
  randomJourney: null,
  journeyRequest: null,
  journeyMarkup: '',
  revision: 0,
  busy: false,
  boardLoadedAt: 0,
  loading: false,
  refreshing: false,
  refreshFailed: false,
};

const elements = {
  locateButton: document.querySelector("#locateButton"),
  locateTopButton: document.querySelector("#locateTopButton"),
  stationSearch: document.querySelector("#stationSearch"),
  stationInput: document.querySelector("#stationInput"),
  statusLine: document.querySelector("#statusLine"),
  stationName: document.querySelector("#stationName"),
  stationMeta: document.querySelector("#stationMeta"),
  platformCount: document.querySelector("#platformCount"),
  stopCount: document.querySelector("#stopCount"),
  drawPlatformButton: document.querySelector("#drawPlatformButton"),
  drawStopsButton: document.querySelector("#drawStopsButton"),
  drawRecheck: document.querySelector("#drawRecheck"),
  trainResult: document.querySelector("#trainResult"),
  stopsPreview: document.querySelector("#stopsPreview"),
  departureList: document.querySelector("#departureList"),
  durationInput: document.querySelector("#durationInput"),
  waitInput: document.querySelector("#waitInput"),
  adventureInput: document.querySelector('#adventureInput'),
  returnInput: document.querySelector('#returnInput'),
  stayInput: document.querySelector('#stayInput'),
  durationHint: document.querySelector("#durationHint"),
  drawMode: document.querySelector('#drawMode'),
  simpleDraw: document.querySelector('#simpleDraw'),
  simpleActivities: document.querySelector('#simpleActivities'),
  adventureControl: document.querySelector('label[for="adventureInput"]'),
  journeyDraw: document.querySelector('#journeyDraw'),
  journeyTrainCount: document.querySelector('#journeyTrainCount'),
  journeyTransfer: document.querySelector('#journeyTransfer'),
  journeyDuration: document.querySelector('#journeyDuration'),
  journeyTransferValue: document.querySelector('#journeyTransferValue'),
  journeyDurationValue: document.querySelector('#journeyDurationValue'),
  generateJourney: document.querySelector('#generateJourney'),
  regenerateJourney: document.querySelector('#regenerateJourney'),
  journeyMessage: document.querySelector('#journeyMessage'),
  journeyResult: document.querySelector('#journeyResult'),
  journeyActions: document.querySelector('#journeyActions'),
  journeyMapLink: document.querySelector('#journeyMapLink'),
};

function initMap() {
  const mapStatus = document.querySelector('#mapStatus');
  try {
  if (!globalThis.L) throw new Error('Leaflet JavaScript is unavailable');
  state.map = L.map("map", {
    zoomControl: false,
    scrollWheelZoom: false,
  }).setView(SWISS_CENTER, 8);

  L.control.zoom({ position: "bottomright", zoomInTitle: t('zoomIn'), zoomOutTitle: t('zoomOut') }).addTo(state.map);
  const translateMapControls = () => {
    for (const [selector, key] of [['.leaflet-control-zoom-in', 'zoomIn'], ['.leaflet-control-zoom-out', 'zoomOut'], ['.leaflet-popup-close-button', 'closePopup']]) {
      const control = document.querySelector(selector);
      if (control) { control.title = t(key); control.setAttribute('aria-label', t(key)); }
    }
    applyTranslations(state.map.getContainer());
  };
  state.map.on('popupopen', translateMapControls);
  window.addEventListener('aletrain:language', translateMapControls);
  const failedTiles = new Set();
  const showTileState = () => {
    mapStatus.hidden = failedTiles.size === 0;
    if (failedTiles.size) setText(mapStatus, 'map.tilesError');
  };
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).on('tileerror', event => {
    failedTiles.add(event.tile);
    console.error('OpenStreetMap tile failed to load', event.error);
    showTileState();
  }).on('tileload', event => { failedTiles.delete(event.tile); showTileState(); })
    .on('tileunload', event => { failedTiles.delete(event.tile); showTileState(); }).addTo(state.map);
  translateMapControls();
  // Leaflet already tracks window resizes. Observe only actual container size changes.
  if (globalThis.ResizeObserver) {
    const observer = new ResizeObserver(() => state.map.invalidateSize({ pan: false }));
    observer.observe(document.querySelector('#map'));
  }
  } catch (error) {
    console.error('Leaflet initialization failed', error);
    setText(mapStatus, 'map.initError');
    mapStatus.hidden = false;
  }
}

function setStatus(key, tone = "neutral", params = {}) {
  setText(elements.statusLine, key, params);
  elements.statusLine.dataset.tone = tone;
}

function setLoading(isLoading) {
  state.loading = isLoading;
  if (isLoading) cancelJourneyRequest();
  updateJourneyButtons();
  elements.locateButton.disabled = isLoading;
  elements.locateTopButton.disabled = isLoading;
  elements.stationInput.disabled = isLoading;
  elements.stationSearch.querySelector("button").disabled = isLoading;
  for (const input of [elements.adventureInput, elements.durationInput, elements.waitInput, elements.returnInput, elements.stayInput]) input.disabled = isLoading;
  if (isLoading) {
    elements.drawPlatformButton.disabled = true;
    elements.drawStopsButton.disabled = true;
  } else refreshDrawableState();
}

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => {
    const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
    return entities[char];
  });
}

function formatTime(value) { return formatDate(value instanceof Date ? value.toISOString() : value); }

function normalizePlatform(platform) {
  const cleaned = String(platform || "").trim();
  return cleaned || t('platform.unknown');
}

function renderStopStatus(stop, journey = null, kind = 'departure') {
  if (cancelled(journey) || cancelled(stop)) return tx('cancelled');
  const delay = delayMinutes(stop, kind);
  const status = tx(hasPrediction(stop, kind) ? 'predicted' : 'scheduled');
  const deviation = delay === null ? '' : ` · ${delay > 0 ? tx('delay', { minutes: delay }) : delay < 0 ? tx('early', { minutes: Math.abs(delay) }) : tx('onTime')}`;
  const planned = String(stop?.platform || '').trim();
  const platform = String(stop?.prognosis?.platform || '').trim();
  return status + deviation + (planned && platform && planned !== platform ? ` · ${tx('platform.changed', { platform, planned })}` : '');
}

function journeyTitle(journey) {
  const category = journey.category || "";
  const number = journey.number || "";
  return `${category} ${number}`.trim() || journey.name || t('service');
}

function journeyDestination(journey) {
  return journey.to || t('destination.unknown');
}

function journeyTitleHtml(journey) {
  return journey.category || journey.number || journey.name ? escapeHtml(journeyTitle(journey)) : tx('service');
}
function journeyDestinationHtml(journey) {
  return journey.to ? escapeHtml(journey.to) : tx('destination.unknown');
}

function journeyDeparture(journey) {
  return stopTime(journey?.stop);
}

function getAvailableMinutes() {
  const minutes = Number(elements.durationInput.value);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
}

function getWaitMinutes() {
  const minutes = Number(elements.waitInput.value);
  return Number.isInteger(minutes) && minutes > 0 ? minutes : null;
}

function travelMinutesToStop(journey, stop) {
  const departure = new Date(journeyDeparture(journey)).getTime();
  const arrival = new Date(stopTime(stop, 'arrival') || stopTime(stop) || "").getTime();
  if (!Number.isFinite(departure) || !Number.isFinite(arrival)) return null;
  return Math.max(0, Math.round((arrival - departure) / 60000));
}

function getStationCoordinates(station) {
  const coord = station?.coordinate || station?.coordinates;
  if (coord?.x == null || coord?.y == null) return null;

  let x = Number(coord.x);
  let y = Number(coord.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  if (Math.abs(x) > 180) x /= 1000000;
  if (Math.abs(y) > 180) y /= 1000000;

  const xLooksLikeSwissLat = x >= 45 && x <= 48.5;
  const yLooksLikeSwissLat = y >= 45 && y <= 48.5;

  if (xLooksLikeSwissLat) return [x, y];
  if (yLooksLikeSwissLat) return [y, x];

  return [x, y];
}

function clearMarkers() {
  state.markers.forEach((marker) => marker.remove());
  state.markers = [];
}

function clearRoute() {
  if (state.routeLayer) {
    state.routeLayer.remove();
    state.routeLayer = null;
  }

  if (state.exitMarker) {
    state.exitMarker.remove();
    state.exitMarker = null;
  }
}

function updateMap(station, journeys = []) {
  if (!state.map) return;
  clearMarkers();
  clearRoute();
  state.map.invalidateSize();

  const stationCoords = getStationCoordinates(station);
  if (stationCoords) {
    const marker = L.marker(stationCoords, {
      icon: L.divIcon({
        className: "station-marker",
        html: "",
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      }),
    }).addTo(state.map);
    marker.bindPopup(`<strong>${escapeHtml(station.name)}</strong><br>${tx('map.departure')}`);
    state.markers.push(marker);
    state.map.setView(stationCoords, 14);
  }

  const passList = journeys
    .flatMap((journey) => journey.passList || [])
    .map((stop) => stop.station)
    .filter(Boolean)
    .slice(0, 12);

  passList.forEach((stop) => {
    const coords = getStationCoordinates(stop);
    if (!coords) return;

    const marker = L.circleMarker(coords, {
      radius: 5,
      color: "#b93224",
      fillColor: "#b93224",
      fillOpacity: 0.68,
      weight: 1,
    }).addTo(state.map);
    marker.bindPopup(escapeHtml(stop.name));
    state.markers.push(marker);
  });
}

function getRoutePoints(journey, exitStop = null) {
  const stationCoords = getStationCoordinates(state.station);
  const reachableStops = getReachableStops(journey);
  const exitIndex = exitStop ? reachableStops.indexOf(exitStop) : -1;
  const visibleStops = exitIndex >= 0 ? reachableStops.slice(0, exitIndex + 1) : reachableStops;
  const routeStops = visibleStops
    .map((stop) => ({
      name: stop.station.name,
      coords: getStationCoordinates(stop.station),
      stop,
    }))
    .filter((point) => point.coords);

  if (!stationCoords || routeStops.length === 0) return [];

  return [
    {
      name: state.station.name,
      coords: stationCoords,
      stop: null,
    },
    ...routeStops,
  ];
}

async function drawJourneyRoute(journey, exitStop = null) {
  if (!state.map) return;
  clearRoute();
  clearMarkers();

  const routePoints = getRoutePoints(journey, exitStop);
  if (routePoints.length < 2) return;

  const latLngs = routePoints.map((point) => point.coords);

  state.routeLayer = L.layerGroup().addTo(state.map);

  L.circleMarker(routePoints[0].coords, {
    radius: 7,
    color: "#fff",
    fillColor: "#b93224",
    fillOpacity: 1,
    weight: 2,
  })
    .bindPopup(`<strong>${escapeHtml(routePoints[0].name)}</strong><br>${tx('map.departure')}`)
    .addTo(state.routeLayer);

  const routeLine = L.polyline(latLngs, {
    color: "#b93224",
    weight: 6,
    opacity: 0.92,
    lineCap: "round",
    lineJoin: "round",
    dashArray: "6 8",
  }).addTo(state.routeLayer);
  const activeLayer = state.routeLayer;

  routePoints.slice(1).forEach((point) => {
    L.circleMarker(point.coords, {
      radius: 5,
      color: "#b93224",
      fillColor: "#faf9f5",
      fillOpacity: 1,
      weight: 2,
    })
      .bindPopup(escapeHtml(point.name))
      .addTo(state.routeLayer);
  });

  if (exitStop) {
    const exitCoords = getStationCoordinates(exitStop.station);
    if (exitCoords) {
      state.exitMarker = L.marker(exitCoords, {
        zIndexOffset: 1000,
        icon: L.divIcon({
          className: "exit-marker",
          html: `<span>${tx('map.exit')}</span>`,
          iconSize: [118, 48],
          iconAnchor: [59, 48],
        }),
      })
        .bindPopup(`<strong>${escapeHtml(exitStop.station.name)}</strong><br>${tx('map.exitStop')}`)
        .addTo(state.map);
    }
  }

  const bounds = L.latLngBounds(latLngs);
  state.map.invalidateSize();
  state.map.fitBounds(bounds, {
    paddingTopLeft: [64, 64],
    paddingBottomRight: [64, 36],
    maxZoom: 12,
  });

  const routeSummary = document.querySelector("#routeSummary");
  routeSummary.hidden = false;
  const title = `${routePoints[0].name} → ${routePoints.at(-1).name}`;
  setText(routeSummary, 'route.loading', { title });
  if (!isRailJourney(journey)) {
    setText(routeSummary, 'route.indicative', { title });
    return;
  }
  try {
    // Fetch the complete possible route once; a new exit only trims its legs.
    const points = getRoutePoints(journey).map(point => point.coords);
    const key = JSON.stringify(points);
    if (!railRouteRequests.has(key)) {
      if (railRouteRequests.size >= 12) railRouteRequests.delete(railRouteRequests.keys().next().value);
      const request = fetchLocalApi("/api/rail-route", {
        method: "POST",
        body: JSON.stringify({ points }),
        signal: AbortSignal.timeout(35000),
      }).catch(error => {
        railRouteRequests.delete(key);
        throw error;
      });
      railRouteRequests.set(key, request);
    }
    const data = await railRouteRequests.get(key);
    if (state.routeLayer !== activeLayer) return;
    const lines = data.lines?.slice(0, routePoints.length - 1);
    if (!lines || lines.length !== routePoints.length - 1 || lines.some(line =>
      !Array.isArray(line) || line.length < 2 || line.some(point =>
        !Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)))) {
      railRouteRequests.delete(key);
      throw Object.assign(new Error('error.request'), { key: 'error.request' });
    }
    routeLine.setLatLngs(lines);
    routeLine.setStyle({ dashArray: null });
    const fittedBounds = routeLine.getBounds().extend(L.latLngBounds(latLngs));
    if (state.activityMarker) fittedBounds.extend(state.activityMarker.getLatLng());
    state.map.fitBounds(fittedBounds, {
      paddingTopLeft: [64, 64], paddingBottomRight: [64, 36], maxZoom: 12,
    });
    setText(routeSummary, 'route.estimated', { title });
  } catch {
    if (state.routeLayer !== activeLayer) return;
    setText(routeSummary, 'route.fallback', { title });
  }
}

async function fetchJson(path, params, signal) {
  const url = new URL(`${API_ROOT}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((item) => url.searchParams.append(key, item));
    } else if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  });

  const timeout = AbortSignal.timeout(15000);
  const response = await fetch(url, { signal: signal ? AbortSignal.any([timeout, signal]) : timeout, cache: 'no-store' });
  if (!response.ok) {
    throw Object.assign(new Error('error.api'), { key: 'error.api', params: { status: response.status } });
  }
  return response.json();
}

async function fetchLocalApi(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(t('error.request'));
  return data;
}

async function findNearestStation(latitude, longitude) {
  const data = await fetchJson("/locations", {
    x: latitude,
    y: longitude,
    type: "station",
  });

  return (data.stations || []).find((station) => station.id && station.name);
}

async function searchStation(query) {
  const data = await fetchJson("/locations", {
    query,
    type: "station",
  });

  return (data.stations || []).find((station) => station.id && station.name);
}

async function loadStationboard(station, { transports = ADVENTURES[elements.adventureInput.value] || ADVENTURES.train, earliest, signal } = {}) {
  const local = earliest === undefined ? null : swissDateTime(earliest);
  const data = await fetchJson("/stationboard", {
    id: station.id,
    limit: 40,
    datetime: local ? `${local.date} ${local.time}` : undefined,
    "transportations[]": transports,
  }, signal);

  return (data.stationboard || [])
    .filter((journey) => journey.stop)
    .sort((a, b) => (journeyDeparture(a) || "").localeCompare(journeyDeparture(b) || ""));
}

function recordBoardReceipt() {
  state.boardLoadedAt = Date.now();
  state.refreshFailed = false;
  setText(document.querySelector('#realtimeStatus'), 'board.updated', { time: formatTime(new Date()) });
}

function serviceKey(journey) {
  return [journey.category, journey.number, journey.to, journey.stop?.departure].join('|');
}
function departureSignature(journey) {
  return JSON.stringify([stopTime(journey.stop), delayMinutes(journey.stop), platformFor(journey), cancelled(journey),
    (journey.passList || []).map(stop => [stop.station?.id, stopTime(stop, 'arrival'), delayMinutes(stop, 'arrival'), platformFor({ stop }), cancelled(stop)])]);
}
async function refreshBoard() {
  if (!state.station || state.loading || state.refreshing || document.hidden) return;
  state.refreshing = true;
  // A station/mode change or a completed transport draw replaces this board.
  const previousBoard = state.stationboard;
  let board;
  try {
    board = await loadStationboard(state.station);
  } catch {
    if (state.loading || state.stationboard !== previousBoard) return;
    state.refreshFailed = true;
    setText(document.querySelector('#realtimeStatus'), 'board.stale', { time: formatTime(new Date(state.boardLoadedAt)) });
    updateDrawStopsButton();
    return;
  } finally { state.refreshing = false; }
  if (state.loading || state.stationboard !== previousBoard) return;
  state.stationboard = board;
  recordBoardReceipt();
  refreshDrawableState();
  updateRandomJourneyFromBoard(board);
}

function selectedJourneyNeedsRecheck() {
  const journey = state.selectedJourney;
  if (!journey) return false;
  if (state.refreshFailed || Date.now() - state.boardLoadedAt > 60000 ||
      Date.parse(journeyDeparture(journey)) < Date.now() + 120000) return true;
  const current = state.stationboard.find(candidate => serviceKey(candidate) === serviceKey(journey));
  return !current || departureSignature(current) !== departureSignature(journey);
}

function updateDrawStopsButton() {
  const needsRecheck = selectedJourneyNeedsRecheck();
  elements.drawRecheck.hidden = !needsRecheck;
  elements.drawStopsButton.disabled = state.loading || state.busy || !state.selectedJourney || needsRecheck;
}

function updateJourneyButtons() {
  elements.drawMode.disabled = state.loading || state.busy;
  elements.generateJourney.disabled = state.loading || !state.station || Boolean(state.journeyRequest);
  elements.regenerateJourney.disabled = elements.generateJourney.disabled || !state.randomJourney;
}

function setJourneyMessage(key = state.station ? null : 'journey.choose', tone = 'neutral') {
  elements.journeyMessage.hidden = !key;
  if (key) setText(elements.journeyMessage, key);
  elements.journeyMessage.dataset.tone = tone;
}

function cancelJourneyRequest() {
  if (!state.journeyRequest) return;
  state.journeyRequest.abort();
  state.journeyRequest = null;
  setJourneyMessage();
  updateJourneyButtons();
}

function updateJourneySliders() {
  for (const [input, value] of [[elements.journeyTransfer, elements.journeyTransferValue], [elements.journeyDuration, elements.journeyDurationValue]]) {
    const minutes = Number(input.value);
    setText(value, 'journey.minutes', { minutes });
    input.setAttribute('aria-valuetext', value.textContent);
  }
}

function renderRandomJourney(firstLeg, needsRecheck = false) {
  const trip = state.randomJourney;
  elements.journeyResult.hidden = !trip;
  elements.journeyActions.hidden = !trip;
  if (!trip) {
    state.journeyMarkup = '';
    setHtml(elements.journeyResult, '');
    return;
  }
  const legs = firstLeg ? [firstLeg, ...trip.legs.slice(1)] : trip.legs;
  const finalLeg = legs.at(-1);
  const minutes = Math.ceil((finalLeg.arrival - trip.startedAt) / 60000);
  const time = timestamp => dateHtml(new Date(timestamp).toISOString(), 'datetime');
  const markup = `
    <strong>${escapeHtml(legs[0].from.name)} → ${escapeHtml(finalLeg.arrivalStop.station.name)}</strong>
    <p>${tx('journey.total', { minutes })}</p>
    ${needsRecheck ? `<p class="status-line" data-tone="warning">${tx('journey.recheck')}</p>` : ''}
    <ol class="journey-legs">${legs.map((leg, index) => {
      const previous = legs[index - 1];
      const wait = previous ? Math.floor((leg.departure - previous.arrival) / 60000) : 0;
      return `<li>
        ${previous ? `<p>${wait < 0 ? tx('journey.missed') : tx('journey.change', { minutes: wait })}</p>` : ''}
        <h3>${journeyTitleHtml(leg.journey)}</h3>
        <p>${escapeHtml(leg.from.name)} · ${time(leg.departure)}<br>
          ${escapeHtml(leg.arrivalStop.station.name)} · ${time(leg.arrival)}</p>
        <p>${renderStopStatus(leg.journey.stop, leg.journey)} · ${renderStopStatus(leg.arrivalStop, null, 'arrival')}</p>
      </li>`;
    }).join('')}</ol>
    <p>${tx('journey.notice')}</p>`;
  if (markup === state.journeyMarkup) return;
  state.journeyMarkup = markup;
  setHtml(elements.journeyResult, markup);
}

function updateRandomJourneyFromBoard(board) {
  const trip = state.randomJourney;
  if (!trip) return;
  const first = trip.legs[0];
  const current = board.find(journey => serviceKey(journey) === serviceKey(first.journey));
  if (!current) return;
  const stop = current.passList?.find(item => String(item.station?.id) === String(first.arrivalStop.station.id));
  const departure = journeyStopTimestamp(current.stop);
  const arrival = journeyStopTimestamp(stop, 'arrival');
  const invalidTimes = Number.isFinite(departure) && Number.isFinite(arrival) && arrival <= departure;
  const updated = {
    ...first,
    journey: current,
    arrivalStop: stop || first.arrivalStop,
    departure: Number.isFinite(departure) && !invalidTimes ? departure : first.departure,
    arrival: Number.isFinite(arrival) && !invalidTimes ? arrival : first.arrival,
  };
  const needsRecheck = cancelled(current) || cancelled(stop) || invalidTimes ||
    Boolean(current.passList?.length && !stop) ||
    updated.departure - trip.startedAt > trip.settings.waitMinutes * 60000 ||
    trip.legs[1].departure - updated.arrival < trip.settings.transferMinutes * 60000;
  renderRandomJourney(updated, needsRecheck);
}

function drawRandomJourneyRoute() {
  const trip = state.randomJourney;
  const summary = document.querySelector('#routeSummary');
  elements.journeyMapLink.hidden = true;
  summary.hidden = true;
  if (!state.map || !state.station) return;
  updateMap(state.station);
  if (!trip) return;
  const lines = trip.legs.map(leg => [getStationCoordinates(leg.from), ...leg.stops.map(stop => getStationCoordinates(stop.station))]);
  if (lines.some(line => !line[0] || !line.at(-1))) return;
  clearMarkers();
  state.routeLayer = L.layerGroup().addTo(state.map);
  const line = L.polyline(lines.map(points => points.filter(Boolean)), {
    color: '#b93224', weight: 5, dashArray: '6 8',
  }).addTo(state.routeLayer);
  const stations = [trip.legs[0].from, ...trip.legs.map(leg => leg.arrivalStop.station)];
  for (const station of stations) {
    L.circleMarker(getStationCoordinates(station), { radius: 6, color: '#b93224', fillColor: '#faf9f5', fillOpacity: 1 })
      .bindPopup(escapeHtml(station.name)).addTo(state.routeLayer);
  }
  state.map.fitBounds(line.getBounds(), { padding: [35, 35], maxZoom: 12 });
  setText(summary, 'route.indicative', { title: `${stations[0].name} → ${stations.at(-1).name}` });
  summary.hidden = false;
  elements.journeyMapLink.hidden = false;
}

async function drawRandomJourney(settings = {
  trainCount: Number(elements.journeyTrainCount.value),
  transferMinutes: Number(elements.journeyTransfer.value),
  maxMinutes: Number(elements.journeyDuration.value),
  waitMinutes: getWaitMinutes(),
}) {
  if (state.loading || !state.station || state.journeyRequest || elements.drawMode.value !== 'journey') return;
  if (!settings.waitMinutes) {
    setJourneyMessage('wait.invalid', 'warning');
    elements.waitInput.focus();
    return;
  }
  const station = state.station;
  const request = new AbortController();
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(25000)]);
  const startedAt = Date.now();
  state.journeyRequest = request;
  updateJourneyButtons();
  setJourneyMessage('journey.search');
  try {
    const legs = await findRandomJourney(station, { ...settings, startedAt },
      (from, earliest) => loadStationboard(from, { transports: ADVENTURES.train, earliest, signal }), signal);
    if (state.journeyRequest !== request) return;
    if (!legs || legs[0].departure <= Date.now()) {
      setJourneyMessage('journey.none', 'warning');
      return;
    }
    state.randomJourney = { legs, settings, startedAt };
    renderRandomJourney();
    drawRandomJourneyRoute();
    setJourneyMessage();
  } catch {
    if (state.journeyRequest === request) setJourneyMessage(signal.aborted ? 'journey.timeout' : 'journey.error', 'warning');
  } finally {
    if (state.journeyRequest === request) {
      state.journeyRequest = null;
      updateJourneyButtons();
    }
  }
}

function syncJourneyMode() {
  const multiTrain = elements.drawMode.value === 'journey';
  elements.simpleDraw.hidden = multiTrain;
  elements.simpleActivities.hidden = multiTrain;
  elements.adventureControl.hidden = multiTrain;
  elements.journeyDraw.hidden = !multiTrain;
  if (!state.station) return;
  if (multiTrain) {
    state.activityMarker?.remove();
    drawRandomJourneyRoute();
  } else {
    cancelJourneyRequest();
    document.querySelector('#routeSummary').hidden = true;
    if (state.selectedJourney) drawJourneyRoute(state.selectedJourney, state.selectedStop);
    else updateMap(state.station, state.stationboard);
    if (state.map) state.activityMarker?.addTo(state.map);
  }
}

function getReachableStops(journey) {
  const minutes = getAvailableMinutes();
  const remainingStops = getRemainingStops(journey).filter(stop => !cancelled(stop));
  if (!minutes) return remainingStops;

  return remainingStops.filter((stop) => {
    const travelMinutes = travelMinutesToStop(journey, stop);
    return travelMinutes !== null && travelMinutes <= minutes;
  });
}

function getDrawableJourneys() {
  const minutes = getAvailableMinutes();
  const waitMinutes = getWaitMinutes();
  if (!minutes || !waitMinutes) return [];
  const now = Date.now();
  const latestDeparture = now + waitMinutes * 60000;

  return state.stationboard.filter((journey) => {
    const platform = platformFor(journey);
    const departure = new Date(journey.stop?.prognosis?.departure || journeyDeparture(journey)).getTime();
    return (platform || !isRailJourney(journey)) && departure >= now + 2 * 60000 && departure <= latestDeparture && !cancelled(journey) &&
      getReachableStops(journey).length > 0;
  });
}

function groupByPlatform(journeys) {
  const grouped = new Map();
  journeys.forEach((journey) => {
    const rawPlatform = platformFor(journey) || (!isRailJourney(journey) ? '__unknown__' : '');
    if (!rawPlatform) return;

    const platform = normalizePlatform(rawPlatform);
    if (!grouped.has(platform)) grouped.set(platform, []);
    grouped.get(platform).push(journey);
  });
  return grouped;
}

function refreshDrawableState() {
  state.platforms = groupByPlatform(getDrawableJourneys());
  const multiTrain = elements.drawMode.value === 'journey';
  const board = multiTrain ? state.stationboard.filter(isRailJourney) : state.stationboard;
  renderStation(board.length, multiTrain);
  renderDepartures(board, multiTrain);
  updateDrawStopsButton();
  updateJourneyButtons();
}

function renderStation(trainTotal, multiTrain) {
  const platformTotal = state.platforms.size;
  const minutes = getAvailableMinutes();
  const waitMinutes = getWaitMinutes();

  elements.stationName.textContent = state.station?.name || t('chooseStation');
  elements.stationMeta.textContent =
    !state.station
      ? t('board.choose')
      : trainTotal > 0
      ? (multiTrain ? plural('departures', trainTotal) :
        t('board.meta', { departures: { key: 'departures', count: trainTotal }, points: { key: 'points', count: platformTotal } }))
      : t('board.empty');
  elements.platformCount.textContent = t(`points.${platformTotal === 1 ? 'one' : 'other'}`, { count: platformTotal });
  elements.drawPlatformButton.disabled = state.busy || platformTotal === 0;
  elements.durationHint.textContent = !waitMinutes
    ? t('wait.invalid')
    : minutes
      ? t('criteria', { points: { key: 'points', count: platformTotal }, minutes, wait: waitMinutes })
      : t('duration.help');
}

function renderDepartures(board, multiTrain) {
  const journeys = board.slice(0, 18);
  if (journeys.length === 0) {
    setHtml(elements.departureList, `
      <article class="empty-state">
        ${state.station ? t('board.noServices') : t('board.pick')}
      </article>
    `);
    return;
  }

  elements.departureList.innerHTML = journeys
    .map((journey) => {
      const platform = normalizePlatform(platformFor(journey));
      const stops = multiTrain ? '' : `<span>${tx('withinDuration', { stops: { key: 'stops', count: getReachableStops(journey).length } })}</span>`;
      return `
        <article class="departure-item">
          <span class="platform-badge">${platform === '__unknown__' ? tx('boardingUnknown') : escapeHtml(platform)}</span>
          <div class="departure-main">
            <strong>${journeyTitleHtml(journey)} → ${journeyDestinationHtml(journey)}</strong>
            <span>${escapeHtml(journey.stop?.station?.name || state.station.name)}</span>
            ${stops}
          </div>
          <div class="departure-side">
            <time class="departure-time">${formatTime(journeyDeparture(journey))}</time>
      <small>${renderStopStatus(journey.stop, journey)}</small>
          </div>
        </article>
      `;
    })
    .join("");
}

function resetDraws() {
  state.revision++;
  state.busy = false;
  window.clearTimeout(state.drawTimer);
  elements.drawPlatformButton.classList.remove("is-spinning");
  window.dispatchEvent(new CustomEvent("aletrain:destination", { detail: null }));
  if (elements.drawMode.value !== 'journey') {
    clearRoute();
    document.querySelector("#routeSummary").hidden = true;
  }
  state.selectedJourney = null;
  state.selectedPlatform = null;
  state.selectedStop = null;
  updateDrawStopsButton();
  setText(elements.stopCount, 'stops.other', { count: 0 });
  setHtml(elements.trainResult, `
    <span class="result-kicker">${tx('result')}</span>
    <strong>${tx('draw.none')}</strong>
    <p>${tx('draw.help')}</p>
  `);
  setText(elements.stopsPreview, 'stop.select');
}

async function selectStation(station) {
  if (!station) {
    setStatus('error.station', "error");
    return;
  }

  setLoading(true);
  resetDraws();
  const revision = state.revision;
  state.stationboard = [];
  setStatus('board.loading', 'neutral', { station: station.name });

  try {
    const board = await loadStationboard(station);
    if (revision !== state.revision) return;
    if (state.station?.id !== station.id) {
      state.randomJourney = null;
      renderRandomJourney();
    }
    state.station = station;
    state.stationboard = board;
    recordBoardReceipt();

    refreshDrawableState();
    if (elements.drawMode.value === 'journey') drawRandomJourneyRoute();
    else updateMap(station, board);
    setJourneyMessage();

    if (board.length === 0) {
      setStatus('board.empty', "warning");
    } else {
      setStatus('ready');
    }
  } catch (error) {
    if (revision !== state.revision) return;
    setStatus(error.key || 'error.board', "error", error.params);
  } finally {
    if (revision === state.revision) setLoading(false);
  }
}

function isRailJourney(journey) {
  return elements.adventureInput.value === 'train' || /^(IC|ICE|ICN|EC|EN|IR|RE|R|S|SN|RJ|RJX|TGV|TER|EXT|PE|BEX|GEX)\d*$/i.test(journey.category || '');
}

function returnSettings() {
  if (!elements.returnInput.value) return null;
  const deadline = swissTimestamp(elements.returnInput.value);
  const stay = Number(elements.stayInput.value);
  if (!Number.isFinite(deadline) || deadline <= Date.now() || !Number.isInteger(stay) || stay < 5 || stay > 1440) {
    throw Object.assign(new Error('return.invalid'), { key: 'return.invalid' });
  }
  return { deadline, stay };
}

function renderReturnSummary(trip, settings) {
  const departure = stopTime(trip.from);
  const arrival = stopTime(trip.to, 'arrival');
  const sections = trip.sections.map(section => {
    const platform = platformFor({ stop: section.departure });
    return `<li>${escapeHtml(section.departure?.station?.name || '')} ${formatTime(stopTime(section.departure))}
      → ${escapeHtml(section.arrival?.station?.name || '')} ${formatTime(stopTime(section.arrival, 'arrival'))}
      · ${section.journey ? journeyTitleHtml(section.journey) : tx('walk')}
      ${platform ? `· ${tx('platform.label', { platform })}` : ''}
      ${section.journey ? `· ${renderStopStatus(section.departure, section.journey)} · ${renderStopStatus(section.arrival, null, 'arrival')}` : ''}</li>`;
  }).join('');
  return `<div class="return-summary"><strong>${tx('return.to', { station: state.station.name })}</strong>
    <p>${tx('return.times', { departure: { date: departure, kind: 'datetime' }, arrival: { date: arrival, kind: 'datetime' } })}
    ${typeof trip.transfers === 'number' ? `· ${px('transfers', trip.transfers)}` : ''}</p>
    <p>${tx('return.note', { minutes: settings.stay, time: formatTime(new Date()) })}</p>
    <ol>${sections}</ol></div>`;
}

async function drawPlatformAndTrain() {
  if (state.busy || !state.station) return;
  const minutes = getAvailableMinutes();
  if (!minutes) {
    setStatus('draw.needDuration', "warning");
    elements.durationInput.focus();
    return;
  }

  resetDraws();
  const revision = state.revision;
  state.busy = true;
  updateJourneyButtons();
  elements.drawPlatformButton.disabled = true;
  elements.drawPlatformButton.classList.add("is-spinning");
  setHtml(elements.trainResult, `
    <span class="result-kicker">${tx('draw')}</span>
    <strong>${tx('checking')}</strong>
    <p>${tx('checking.help')}</p>
  `);
  try {
    returnSettings();
    const board = await loadStationboard(state.station);
    if (revision !== state.revision) return;
    state.stationboard = board;
    recordBoardReceipt();
    refreshDrawableState();
    const platforms = [...state.platforms.keys()];
    if (!platforms.length) throw Object.assign(new Error('draw.noMatch'), { key: 'draw.noMatch' });
    const platform = randomItem(platforms);
    const platformJourneys = [...state.platforms.get(platform)].sort((a, b) =>
      (journeyDeparture(a) || "").localeCompare(journeyDeparture(b) || ""),
    );
    const journey = randomItem(platformJourneys);

    state.selectedPlatform = platform;
    state.selectedJourney = journey;

    const reachableStops = getReachableStops(journey);
    setText(elements.stopCount, 'stops.other', { count: reachableStops.length });
    setHtml(elements.trainResult, `
      <span class="result-kicker">${tx('departure')} · ${platform === '__unknown__' ? tx('boardingUnknown') : escapeHtml(platform)}</span>
      <strong>${journeyTitleHtml(journey)} → ${journeyDestinationHtml(journey)}</strong>
      <div class="train-meta">
        <span class="train-chip">${tx('departure.at', { time: formatTime(journeyDeparture(journey)) })}</span>
        <span class="train-chip">${renderStopStatus(journey.stop, journey)}</span>
        <span class="train-chip">${tx('possibleStops', { stops: { key: 'stops', count: reachableStops.length } })}</span>
      </div>
      <a class="map-link" href="#journeyMap">${tx('map.see')}<span aria-hidden="true">↗</span></a>
    `);
    setText(elements.stopsPreview, 'stop.ready');
    if (elements.returnInput.value) setText(elements.stopsPreview, 'return.pending');
    setStatus('verified', 'neutral', { time: formatTime(new Date()) });
    updateMap(state.station, [journey]);
    drawJourneyRoute(journey);
  } catch (error) {
    if (revision !== state.revision) return;
    setText(elements.trainResult, 'draw.unavailable');
    setStatus(error.key || 'error.verify', 'error', error.params);
  } finally {
    if (revision === state.revision) {
      state.busy = false;
      elements.drawPlatformButton.classList.remove('is-spinning');
      refreshDrawableState();
    }
  }
}

function getRemainingStops(journey) {
  const passList = journey?.passList || [];
  if (!passList.length) return [];

  const departureStationId = journey.stop?.station?.id || state.station?.id;
  const departureIndex = passList.findIndex((stop) => stop.station?.id === departureStationId);
  const startIndex = departureIndex >= 0 ? departureIndex + 1 : 1;

  return passList.slice(startIndex).filter((stop) => stop.station?.name);
}

async function drawStops() {
  if (state.busy || !state.selectedJourney) return;
  if (selectedJourneyNeedsRecheck()) {
    updateDrawStopsButton();
    return;
  }
  let settings;
  try { settings = returnSettings(); } catch (error) { setStatus(error.key || 'return.invalid', 'warning'); return; }
  const reachableStops = getReachableStops(state.selectedJourney);
  if (reachableStops.length === 0) return;
  const revision = state.revision;
  state.busy = true;
  state.selectedStop = null;
  refreshDrawableState();
  window.dispatchEvent(new CustomEvent('aletrain:destination', { detail: null }));
  clearRoute();
  document.querySelector('#routeSummary').hidden = true;
  let destinationStop = randomItem(reachableStops);
  let returnTrip = null;
  try {
    if (settings) {
      setText(elements.stopsPreview, 'return.search');
      // Shuffle without replacement, then cap network work per user action.
      const candidates = [...reachableStops];
      for (let i = candidates.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
      }
      for (const stop of candidates.slice(0, 6)) {
        const arrival = Date.parse(stopTime(stop, 'arrival') || stopTime(stop));
        const earliest = arrival + settings.stay * 60000;
        if (!stop.station?.id || !Number.isFinite(earliest) || earliest >= settings.deadline) continue;
        const data = await fetchJson('/connections', {
          from: stop.station.id, to: state.station.id, ...swissDateTime(earliest), limit: 4,
          'transportations[]': ADVENTURES[elements.adventureInput.value],
        });
        if (revision !== state.revision) return;
        returnTrip = (data.connections || []).find(connection => usableReturn(connection, earliest, settings.deadline));
        if (returnTrip) { destinationStop = stop; break; }
      }
      if (!returnTrip) throw Object.assign(new Error('return.none'), { key: 'return.none' });
    }
    if (revision !== state.revision) return;
    if (selectedJourneyNeedsRecheck()) throw Object.assign(new Error('recheck'), { key: 'recheck' });
  } catch (error) {
    if (revision === state.revision) {
      setText(elements.stopsPreview, settings ? 'stop.unconfirmedReturn' : 'stop.unconfirmed');
      setStatus(error.key || 'error.return', 'error', error.params);
    }
    return;
  } finally {
    if (revision === state.revision) {
      state.busy = false;
      refreshDrawableState();
    }
  }
  const allStops = getRemainingStops(state.selectedJourney);
  const count = allStops.indexOf(destinationStop) + 1;
  const visibleStops = allStops.slice(0, Math.min(count, 5));

  setText(elements.stopCount, 'stops.other', { count });
  setHtml(elements.stopsPreview, `
    <div class="stop-destination">
      <span class="result-kicker">${tx('exit.after', { stops: { key: 'stops', count } })}</span>
      <strong>${escapeHtml(destinationStop.station.name)}</strong>
      <p>${stopTime(destinationStop, 'arrival') ? tx('arrival.at', { time: formatTime(stopTime(destinationStop, 'arrival')) }) : tx('announcements')}</p>
      <p>${renderStopStatus(destinationStop, null, 'arrival')}</p>
      ${returnTrip ? renderReturnSummary(returnTrip, settings) : ''}
    </div>
    <ol class="stop-list">
      ${visibleStops
        .map(
          (stop, index) => `
            <li>
              <span>${index + 1}. ${escapeHtml(stop.station.name)}</span>
              <time>${dateHtml(stopTime(stop, 'arrival'))}</time>
            </li>
          `,
        )
        .join("")}
      ${
        count > visibleStops.length
          ? `<li><span>${tx('stops.more', { stops: { key: 'stops', count: count - visibleStops.length } })}</span><time></time></li>`
          : ""
      }
    </ol>
    <a class="map-link" href="#journeyMap">${tx('map.seeMine')}<span aria-hidden="true">↗</span></a>
  `);

  state.selectedStop = destinationStop;
  window.dispatchEvent(new CustomEvent("aletrain:destination", {
    detail: { name: destinationStop.station.name, coords: getStationCoordinates(destinationStop.station) },
  }));
  drawJourneyRoute(state.selectedJourney, destinationStop);
}

window.addEventListener("aletrain:activity-selected", event => {
  state.activityMarker?.remove();
  state.activityMarker = null;
  const place = event.detail;
  if (!place || !state.map) return;
  state.activityMarker = L.marker(place.coords, {
    icon: L.divIcon({ className: "activity-marker", html: "<span aria-hidden=\"true\">↗</span>", iconSize: [30, 30], iconAnchor: [15, 15] }),
  }).bindPopup(`<strong>${escapeHtml(place.name)}</strong><br>${tx('map.activity')}`);
  if (elements.drawMode.value === 'journey') return;
  state.activityMarker.addTo(state.map);
  const routeLine = state.routeLayer?.getLayers().find(layer => layer instanceof L.Polyline);
  const bounds = routeLine ? routeLine.getBounds() : L.latLngBounds([place.coords]);
  state.map.fitBounds(bounds.extend(place.coords), { padding: [48, 48], maxZoom: 14 });
});

function useGeolocation() {
  if (!navigator.geolocation) {
    setStatus('geo.unavailable', "error");
    return;
  }

  setLoading(true);
  setStatus('geo.search');

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      try {
        const { latitude, longitude } = position.coords;
        state.map?.setView([latitude, longitude], 13);
        setStatus('geo.station');
        const station = await findNearestStation(latitude, longitude);
        await selectStation(station);
      } catch (error) {
        setStatus(error.key || 'geo.error', "error", error.params);
      } finally {
        setLoading(false);
      }
    },
    () => {
      setLoading(false);
      setStatus('geo.denied', "warning");
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 60000,
    },
  );
}

elements.locateButton.addEventListener("click", useGeolocation);
elements.locateTopButton.addEventListener("click", useGeolocation);
elements.drawPlatformButton.addEventListener("click", drawPlatformAndTrain);
elements.drawStopsButton.addEventListener("click", drawStops);
elements.drawMode.addEventListener('change', () => {
  syncJourneyMode();
  refreshDrawableState();
});
elements.generateJourney.addEventListener('click', () => drawRandomJourney());
elements.regenerateJourney.addEventListener('click', () => {
  if (state.randomJourney) drawRandomJourney(state.randomJourney.settings);
});
elements.journeyTrainCount.addEventListener('change', cancelJourneyRequest);
for (const slider of [elements.journeyTransfer, elements.journeyDuration]) {
  slider.addEventListener('input', () => {
    updateJourneySliders();
    cancelJourneyRequest();
  });
}
elements.durationInput.addEventListener("input", () => {
  resetDraws();
  refreshDrawableState();
});
elements.waitInput.addEventListener("input", () => {
  cancelJourneyRequest();
  resetDraws();
  refreshDrawableState();
});

for (const input of [elements.returnInput, elements.stayInput]) {
  input.addEventListener('input', () => { resetDraws(); refreshDrawableState(); });
}
elements.adventureInput.addEventListener('change', () => {
  resetDraws();
  state.stationboard = [];
  refreshDrawableState();
  if (state.station) selectStation(state.station);
});

elements.stationSearch.addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = elements.stationInput.value.trim();
  if (!query) {
    setStatus('search.empty', "warning");
    return;
  }

  setLoading(true);
  setStatus('search.loading', 'neutral', { query });

  try {
    const station = await searchStation(query);
    await selectStation(station);
  } catch (error) {
    setStatus(error.key || 'search.error', "error", error.params);
  } finally {
    setLoading(false);
  }
});

initMap();
syncJourneyMode();
updateJourneySliders();
window.addEventListener('aletrain:language', () => {
  refreshDrawableState();
  applyTranslations();
  updateJourneySliders();
});
window.setInterval(refreshBoard, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshBoard(); });
