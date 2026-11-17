import { ADVENTURES, stopTime, platformFor, cancelled, usableReturn, swissDateTime, swissTimestamp } from './adventure.js';
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
  revision: 0,
  busy: false,
  boardLoadedAt: 0,
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
  trainResult: document.querySelector("#trainResult"),
  stopsPreview: document.querySelector("#stopsPreview"),
  departureList: document.querySelector("#departureList"),
  durationInput: document.querySelector("#durationInput"),
  waitInput: document.querySelector("#waitInput"),
  adventureInput: document.querySelector('#adventureInput'),
  returnInput: document.querySelector('#returnInput'),
  stayInput: document.querySelector('#stayInput'),
  durationHint: document.querySelector("#durationHint"),
};

function initMap() {
  state.map = L.map("map", {
    zoomControl: false,
    scrollWheelZoom: false,
  }).setView(SWISS_CENTER, 8);

  L.control.zoom({ position: "bottomright" }).addTo(state.map);

  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(state.map);

  window.setTimeout(() => state.map.invalidateSize(), 120);
  window.addEventListener("resize", () => state.map.invalidateSize());
}

function setStatus(message, tone = "neutral") {
  elements.statusLine.textContent = message;
  elements.statusLine.dataset.tone = tone;
}

function setLoading(isLoading) {
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

function formatTime(value) {
  if (!value) return "--:--";
  return new Intl.DateTimeFormat("fr-CH", {
    timeZone: 'Europe/Zurich',
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function normalizePlatform(platform) {
  const cleaned = String(platform || "").trim();
  return cleaned || "sans quai";
}

function journeyTitle(journey) {
  const category = journey.category || "";
  const number = journey.number || "";
  return `${category} ${number}`.trim() || journey.name || "Train";
}

function journeyDestination(journey) {
  return journey.to || "Destination inconnue";
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
  if (!coord) return null;

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
    marker.bindPopup(`<strong>${escapeHtml(station.name)}</strong><br>Gare de départ`);
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
    .bindPopup(`<strong>${escapeHtml(routePoints[0].name)}</strong><br>Gare de départ`)
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
          html: `<span>Sortir ici</span>`,
          iconSize: [118, 48],
          iconAnchor: [59, 48],
        }),
      })
        .bindPopup(`<strong>${escapeHtml(exitStop.station.name)}</strong><br>Arrêt de sortie`)
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
  routeSummary.textContent = `${title} · Chargement du tracé ferroviaire…`;
  if (!isRailJourney(journey)) {
    routeSummary.textContent = `${title} · Tracé indicatif entre les arrêts`;
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
      throw new Error("Tracé incomplet.");
    }
    routeLine.setLatLngs(lines);
    routeLine.setStyle({ dashArray: null });
    const fittedBounds = routeLine.getBounds().extend(L.latLngBounds(latLngs));
    if (state.activityMarker) fittedBounds.extend(state.activityMarker.getLatLng());
    state.map.fitBounds(fittedBounds, {
      paddingTopLeft: [64, 64], paddingBottomRight: [64, 36], maxZoom: 12,
    });
    routeSummary.textContent = `${title} · Sur les voies, parcours estimé`;
  } catch {
    if (state.routeLayer !== activeLayer) return;
    routeSummary.textContent = `${title} · Tracé simplifié, voies indisponibles`;
  }
}

async function fetchJson(path, params) {
  const url = new URL(`${API_ROOT}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((item) => url.searchParams.append(key, item));
    } else if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  });

  const response = await fetch(url, { signal: AbortSignal.timeout(15000), cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Erreur API (${response.status})`);
  }
  return response.json();
}

async function fetchLocalApi(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Requête impossible.");
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

async function loadStationboard(station) {
  const data = await fetchJson("/stationboard", {
    id: station.id,
    limit: 40,
    "transportations[]": ADVENTURES[elements.adventureInput.value] || ADVENTURES.train,
  });

  return (data.stationboard || [])
    .filter((journey) => journey.stop)
    .sort((a, b) => (journeyDeparture(a) || "").localeCompare(journeyDeparture(b) || ""));
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
    const rawPlatform = platformFor(journey) || (!isRailJourney(journey) ? 'Point de départ à vérifier' : '');
    if (!rawPlatform) return;

    const platform = normalizePlatform(rawPlatform);
    if (!grouped.has(platform)) grouped.set(platform, []);
    grouped.get(platform).push(journey);
  });
  return grouped;
}

function refreshDrawableState() {
  state.platforms = groupByPlatform(getDrawableJourneys());
  renderStation();
  renderDepartures();
}

function renderStation() {
  const platformTotal = state.platforms.size;
  const trainTotal = state.stationboard.length;
  const minutes = getAvailableMinutes();
  const waitMinutes = getWaitMinutes();

  elements.stationName.textContent = state.station?.name || "Choisis ta gare de départ";
  elements.stationMeta.textContent =
    !state.station
      ? "Choisis une gare pour voir les prochains trains."
      : trainTotal > 0
      ? `${trainTotal} prochains départs visibles · ${platformTotal} points de départ compatibles avec tes critères.`
      : "Aucun prochain départ n'a été trouvé pour ces modes.";
  elements.platformCount.textContent = `${platformTotal} point${platformTotal > 1 ? "s" : ""}`;
  elements.drawPlatformButton.disabled = state.busy || platformTotal === 0;
  elements.durationHint.textContent = !waitMinutes
    ? "Indique une attente maximale d'au moins 1 minute."
    : minutes
      ? `${platformTotal} point${platformTotal > 1 ? "s" : ""} de départ · trajet ≤ ${minutes} min · attente ≤ ${waitMinutes} min.`
      : "Indique une durée pour activer le tirage.";
}

function renderDepartures() {
  const journeys = state.stationboard.slice(0, 18);
  if (journeys.length === 0) {
    elements.departureList.innerHTML = `
      <article class="empty-state">
        ${state.station ? "Aucun transport n'est disponible dans les prochains départs de cet arrêt." : "Choisis une gare ou un arrêt pour découvrir les prochains départs."}
      </article>
    `;
    return;
  }

  elements.departureList.innerHTML = journeys
    .map((journey) => {
      const platform = normalizePlatform(platformFor(journey));
      const reachableStops = getReachableStops(journey);
      return `
        <article class="departure-item">
          <span class="platform-badge">${escapeHtml(platform)}</span>
          <div class="departure-main">
            <strong>${escapeHtml(journeyTitle(journey))} → ${escapeHtml(journeyDestination(journey))}</strong>
            <span>${escapeHtml(journey.stop?.station?.name || state.station.name)}</span>
            <span>${getReachableStops(journey).length} arrêt${reachableStops.length > 1 ? "s" : ""} dans la durée</span>
          </div>
          <div class="departure-side">
            <time class="departure-time">${formatTime(journeyDeparture(journey))}</time>
            <small>${cancelled(journey) ? 'Supprimé' : journey.stop?.prognosis?.departure ? 'Prévision actualisée' : 'Horaire prévu'}</small>
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
  clearRoute();
  document.querySelector("#routeSummary").hidden = true;
  state.selectedJourney = null;
  state.selectedPlatform = null;
  elements.drawStopsButton.disabled = true;
  elements.stopCount.textContent = "0 arrêt";
  elements.trainResult.innerHTML = `
    <span class="result-kicker">Résultat</span>
    <strong>Aucun transport tiré au sort</strong>
    <p>Indique d'abord ton temps disponible, puis tire un départ compatible.</p>
  `;
  elements.stopsPreview.textContent = "Sélectionne d'abord un transport.";
}

async function selectStation(station) {
  if (!station) {
    setStatus("Aucune gare n'a été trouvée. Essaie un autre nom.", "error");
    return;
  }

  setLoading(true);
  resetDraws();
  const revision = state.revision;
  state.stationboard = [];
  setStatus(`Chargement des prochains trains pour ${station.name}...`);

  try {
    const board = await loadStationboard(station);
    if (revision !== state.revision) return;
    state.station = station;
    state.stationboard = board;
    state.boardLoadedAt = Date.now();

    refreshDrawableState();
    updateMap(station, board);

    if (board.length === 0) {
      setStatus("Arrêt trouvé, mais aucun transport n'est disponible pour ces modes.", "warning");
    } else {
      setStatus("Prêt. Indique ton temps disponible puis tire un départ.");
    }
  } catch (error) {
    if (revision !== state.revision) return;
    setStatus(error.message || "Impossible de charger les départs.", "error");
  } finally {
    if (revision === state.revision) setLoading(false);
  }
}

function isRailJourney(journey) {
  return elements.adventureInput.value === 'train' || /^(IC|ICE|ICN|EC|EN|IR|RE|R|S|SN|RJ|RJX|TGV|TER|EXT|PE|BEX|GEX)\d*$/i.test(journey.category || '') ||
    journey.categoryCode === 0 || journey.categoryCode === 1 || journey.categoryCode === 2;
}

function returnSettings() {
  if (!elements.returnInput.value) return null;
  const deadline = swissTimestamp(elements.returnInput.value);
  const stay = Number(elements.stayInput.value);
  if (!Number.isFinite(deadline) || deadline <= Date.now() || !Number.isInteger(stay) || stay < 5 || stay > 1440) {
    throw new Error('Choisis un retour futur (heure suisse) et entre 5 et 1440 minutes sur place.');
  }
  return { deadline, stay };
}

function renderReturnSummary(trip, settings) {
  const departure = stopTime(trip.from);
  const arrival = stopTime(trip.to, 'arrival');
  const date = value => swissDateTime(Date.parse(value)).date;
  const sections = trip.sections.map(section => {
    const platform = platformFor({ stop: section.departure });
    return `<li>${escapeHtml(section.departure?.station?.name || '')} ${formatTime(stopTime(section.departure))}
      → ${escapeHtml(section.arrival?.station?.name || '')} ${formatTime(stopTime(section.arrival, 'arrival'))}
      · ${escapeHtml(section.journey ? journeyTitle(section.journey) : 'À pied')}
      ${platform ? `· quai / arrêt ${escapeHtml(platform)}` : ''}</li>`;
  }).join('');
  return `<div class="return-summary"><strong>Retour vers ${escapeHtml(state.station.name)}</strong>
    <p>Départ le ${date(departure)} à ${formatTime(departure)} · arrivée le ${date(arrival)} à ${formatTime(arrival)}
    · ${escapeHtml(String(trip.transfers ?? '?'))} changement(s).</p>
    <p>${settings.stay} min minimum sur place. Horaires vérifiés à ${formatTime(new Date())}, à reconfirmer avant le retour.</p>
    <ol>${sections}</ol></div>`;
}

async function drawPlatformAndTrain() {
  if (state.busy || !state.station) return;
  const minutes = getAvailableMinutes();
  if (!minutes) {
    setStatus("Indique le temps disponible avant de tirer un trajet.", "warning");
    elements.durationInput.focus();
    return;
  }

  resetDraws();
  const revision = state.revision;
  state.busy = true;
  elements.drawPlatformButton.disabled = true;
  elements.drawPlatformButton.classList.add("is-spinning");
  elements.trainResult.innerHTML = `
    <span class="result-kicker">Tirage</span>
    <strong>Vérification des départs…</strong>
    <p>Horaires et points de départ actualisés · marge de 2 minutes pour embarquer.</p>
  `;
  try {
    returnSettings();
    const board = await loadStationboard(state.station);
    if (revision !== state.revision) return;
    state.stationboard = board;
    state.boardLoadedAt = Date.now();
    refreshDrawableState();
    const platforms = [...state.platforms.keys()];
    if (!platforms.length) throw new Error('Aucun départ compatible avec tes critères et la marge de 2 minutes. Augmente les durées ou change de mode.');
    const platform = randomItem(platforms);
    const platformJourneys = [...state.platforms.get(platform)].sort((a, b) =>
      (journeyDeparture(a) || "").localeCompare(journeyDeparture(b) || ""),
    );
    const journey = randomItem(platformJourneys);

    state.selectedPlatform = platform;
    state.selectedJourney = journey;
    elements.drawPlatformButton.classList.remove("is-spinning");
    refreshDrawableState();
    elements.drawStopsButton.disabled = false;

    const reachableStops = getReachableStops(journey);
    elements.stopCount.textContent = `${reachableStops.length} arrêt${reachableStops.length > 1 ? "s" : ""}`;
    elements.trainResult.innerHTML = `
      <span class="result-kicker">Départ · ${escapeHtml(platform)}</span>
      <strong>${escapeHtml(journeyTitle(journey))} → ${escapeHtml(journeyDestination(journey))}</strong>
      <div class="train-meta">
        <span class="train-chip">Départ ${formatTime(journeyDeparture(journey))}</span>
        <span class="train-chip">${journey.stop?.prognosis?.departure ? 'Prévision actualisée' : 'Horaire prévu'}</span>
        <span class="train-chip">${reachableStops.length} arrêts possibles</span>
      </div>
      <a class="map-link" href="#journeyMap">Voir le trajet sur la carte <span aria-hidden="true">↗</span></a>
    `;
    elements.stopsPreview.textContent = "Le transport est choisi. Tire maintenant ton arrêt.";
    if (elements.returnInput.value) elements.stopsPreview.textContent = 'Le retour sera vérifié avant de confirmer ton arrêt de sortie.';
    setStatus(`Départs vérifiés à ${formatTime(new Date())}. Consulte aussi les annonces sur place.`);
    updateMap(state.station, [journey]);
    drawJourneyRoute(journey);
  } catch (error) {
    if (revision !== state.revision) return;
    elements.trainResult.textContent = 'Tirage indisponible. Réessaie après avoir vérifié tes critères.';
    setStatus(error.message || 'Vérification des départs impossible.', 'error');
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
  if (Date.now() - state.boardLoadedAt > 60000 || Date.parse(journeyDeparture(state.selectedJourney)) < Date.now() + 120000) {
    resetDraws();
    refreshDrawableState();
    setStatus('Les départs doivent être revérifiés. Choisis à nouveau ton transport.', 'warning');
    return;
  }
  let settings;
  try { settings = returnSettings(); } catch (error) { setStatus(error.message, 'warning'); return; }
  const reachableStops = getReachableStops(state.selectedJourney);
  if (reachableStops.length === 0) return;
  const revision = state.revision;
  state.busy = true;
  refreshDrawableState();
  elements.drawStopsButton.disabled = true;
  window.dispatchEvent(new CustomEvent('aletrain:destination', { detail: null }));
  clearRoute();
  document.querySelector('#routeSummary').hidden = true;
  let destinationStop = randomItem(reachableStops);
  let returnTrip = null;
  try {
    if (settings) {
      elements.stopsPreview.textContent = 'Recherche d’un retour compatible…';
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
      if (!returnTrip) throw new Error('Aucun retour compatible trouvé parmi les 6 arrêts testés au maximum. Essaie un autre tirage, un retour plus tard ou moins de temps sur place.');
    }
    if (revision !== state.revision) return;
    if (Date.now() - state.boardLoadedAt > 60000 || Date.parse(journeyDeparture(state.selectedJourney)) < Date.now() + 120000) throw new Error('Les départs doivent être revérifiés. Choisis à nouveau ton transport.');
  } catch (error) {
    if (revision === state.revision) {
      elements.stopsPreview.textContent = settings ? 'Arrêt non confirmé : retour non vérifié.' : 'Arrêt non confirmé.';
      setStatus(error.message || 'Recherche du retour indisponible.', 'error');
    }
    return;
  } finally {
    if (revision === state.revision) {
      state.busy = false;
      elements.drawStopsButton.disabled = false;
      refreshDrawableState();
    }
  }
  const allStops = getRemainingStops(state.selectedJourney);
  const count = allStops.indexOf(destinationStop) + 1;
  const visibleStops = allStops.slice(0, Math.min(count, 5));

  elements.stopCount.textContent = `${count} arrêt${count > 1 ? "s" : ""}`;
  elements.stopsPreview.innerHTML = `
    <div class="stop-destination">
      <span class="result-kicker">Descendre après ${count} arrêt${count > 1 ? "s" : ""}</span>
      <strong>${escapeHtml(destinationStop.station.name)}</strong>
      <p>${stopTime(destinationStop, 'arrival') ? `Arrivée prévue à ${formatTime(stopTime(destinationStop, 'arrival'))}.` : "Garde un oeil sur les annonces à bord."}</p>
      ${returnTrip ? renderReturnSummary(returnTrip, settings) : ''}
    </div>
    <ol class="stop-list">
      ${visibleStops
        .map(
          (stop, index) => `
            <li>
              <span>${index + 1}. ${escapeHtml(stop.station.name)}</span>
              <time>${stop.arrival ? formatTime(stop.arrival) : ""}</time>
            </li>
          `,
        )
        .join("")}
      ${
        count > visibleStops.length
          ? `<li><span>... ${count - visibleStops.length} arrêt${count - visibleStops.length > 1 ? "s" : ""} de plus</span><time></time></li>`
          : ""
      }
    </ol>
    <a class="map-link" href="#journeyMap">Voir mon trajet sur la carte <span aria-hidden="true">↗</span></a>
  `;

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
  }).bindPopup(`<strong>${escapeHtml(place.name)}</strong><br>Ton idée sur place`).addTo(state.map);
  const routeLine = state.routeLayer?.getLayers().find(layer => layer instanceof L.Polyline);
  const bounds = routeLine ? routeLine.getBounds() : L.latLngBounds([place.coords]);
  state.map.fitBounds(bounds.extend(place.coords), { padding: [48, 48], maxZoom: 14 });
});

function useGeolocation() {
  if (!navigator.geolocation) {
    setStatus("La géolocalisation n'est pas disponible dans ce navigateur.", "error");
    return;
  }

  setLoading(true);
  setStatus("Recherche de ta position...");

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      try {
        const { latitude, longitude } = position.coords;
        state.map.setView([latitude, longitude], 13);
        setStatus("Position trouvée. Recherche de la gare la plus proche...");
        const station = await findNearestStation(latitude, longitude);
        await selectStation(station);
      } catch (error) {
        setStatus(error.message || "Impossible de trouver une gare proche.", "error");
      } finally {
        setLoading(false);
      }
    },
    () => {
      setLoading(false);
      setStatus("Position refusée ou indisponible. Tu peux chercher une gare manuellement.", "warning");
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
elements.durationInput.addEventListener("input", () => {
  resetDraws();
  refreshDrawableState();
});
elements.waitInput.addEventListener("input", () => {
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
    setStatus("Entre le nom d'une gare pour lancer la recherche.", "warning");
    return;
  }

  setLoading(true);
  setStatus(`Recherche de "${query}"...`);

  try {
    const station = await searchStation(query);
    await selectStation(station);
  } catch (error) {
    setStatus(error.message || "La recherche de gare a échoué.", "error");
  } finally {
    setLoading(false);
  }
});

initMap();
