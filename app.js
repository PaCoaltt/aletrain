const API_ROOT = "https://transport.opendata.ch/v1";
const SWISS_CENTER = [46.8182, 8.2275];

const state = {
  map: null,
  markers: [],
  routeLayer: null,
  exitMarker: null,
  station: null,
  stationboard: [],
  platforms: new Map(),
  selectedJourney: null,
  selectedPlatform: null,
  reports: [],
  profile: JSON.parse(localStorage.getItem("aletrainProfile") || "null"),
  reportTarget: null,
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
  profileForm: document.querySelector("#profileForm"),
  usernameInput: document.querySelector("#usernameInput"),
  passwordInput: document.querySelector("#passwordInput"),
  createProfileButton: document.querySelector("#createProfileButton"),
  loginProfileButton: document.querySelector("#loginProfileButton"),
  logoutButton: document.querySelector("#logoutButton"),
  profileStatus: document.querySelector("#profileStatus"),
  profileName: document.querySelector("#profileName"),
  reportModal: document.querySelector("#reportModal"),
  reportForm: document.querySelector("#reportForm"),
  reportTitle: document.querySelector("#reportTitle"),
  reportReason: document.querySelector("#reportReason"),
  reportDuration: document.querySelector("#reportDuration"),
  closeReportModal: document.querySelector("#closeReportModal"),
};

function initMap() {
  state.map = L.map("map", {
    zoomControl: false,
    scrollWheelZoom: true,
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

function setProfileStatus(message, tone = "neutral") {
  elements.profileStatus.textContent = message;
  elements.profileStatus.dataset.tone = tone;
}

function setLoading(isLoading) {
  elements.locateButton.disabled = isLoading;
  elements.locateTopButton.disabled = isLoading;
  elements.stationInput.disabled = isLoading;
  elements.stationSearch.querySelector("button").disabled = isLoading;
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
  return journey.stop?.departure || journey.stop?.prognosis?.departure || null;
}

function journeyId(journey) {
  return [
    state.station?.id || journey.stop?.station?.id || "station",
    journeyTitle(journey),
    journeyDestination(journey),
    journeyDeparture(journey) || "departure",
    journey.stop?.platform || journey.stop?.prognosis?.platform || "platform",
  ].join("|");
}

function currentUsername() {
  return state.profile?.username || "";
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
      color: "#cc785c",
      fillColor: "#cc785c",
      fillOpacity: 0.68,
      weight: 1,
    }).addTo(state.map);
    marker.bindPopup(escapeHtml(stop.name));
    state.markers.push(marker);
  });
}

function getRoutePoints(journey) {
  const stationCoords = getStationCoordinates(state.station);
  const routeStops = getRemainingStops(journey)
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

function drawJourneyRoute(journey, exitStop = null) {
  clearRoute();

  const routePoints = getRoutePoints(journey);
  if (routePoints.length < 2) return;

  const latLngs = routePoints.map((point) => point.coords);

  state.routeLayer = L.layerGroup().addTo(state.map);

  L.polyline(latLngs, {
    color: "#cc2f2f",
    weight: 6,
    opacity: 0.92,
    lineCap: "round",
    lineJoin: "round",
  }).addTo(state.routeLayer);

  routePoints.slice(1).forEach((point) => {
    L.circleMarker(point.coords, {
      radius: 5,
      color: "#cc2f2f",
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
  state.map.fitBounds(bounds, {
    paddingTopLeft: [24, 90],
    paddingBottomRight: [24, 36],
    maxZoom: 12,
  });
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

  const response = await fetch(url);
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
    "transportations[]": "train",
  });

  return (data.stationboard || [])
    .filter((journey) => journey.stop)
    .sort((a, b) => (journeyDeparture(a) || "").localeCompare(journeyDeparture(b) || ""));
}

async function loadReports() {
  try {
    const data = await fetchLocalApi("/api/reports");
    state.reports = data.reports || [];
  } catch {
    state.reports = [];
  }
}

function findReport(journey) {
  const id = journeyId(journey);
  return state.reports.find((report) => report.trainId === id);
}

function reportIncludesUser(report, field) {
  const username = currentUsername();
  return Boolean(username && (report?.[field] || []).includes(username));
}

function isReportedByCurrentUser(report) {
  return Boolean(report && report.reportedBy === currentUsername());
}

function isReportIgnoredForCurrentUser(report) {
  return reportIncludesUser(report, "denials");
}

function isTrainHiddenForCurrentUser(journey) {
  const report = findReport(journey);
  return Boolean(report && reportIncludesUser(report, "confirmations"));
}

function isTrainBlockedFromDraw(journey) {
  const report = findReport(journey);
  if (!report || isReportIgnoredForCurrentUser(report)) return false;
  return isReportedByCurrentUser(report) || reportIncludesUser(report, "confirmations");
}

function getVisibleReportForCurrentUser(journey) {
  const report = findReport(journey);
  if (!report || isReportIgnoredForCurrentUser(report)) return null;
  return report;
}

function getReachableStops(journey) {
  return getRemainingStops(journey);
}

function getDrawableJourneys() {
  return state.stationboard.filter((journey) => {
    const platform = String(journey.stop?.platform || journey.stop?.prognosis?.platform || "").trim();
    return platform && !isTrainBlockedFromDraw(journey) && getReachableStops(journey).length > 0;
  });
}

function groupByPlatform(journeys) {
  const grouped = new Map();
  journeys.forEach((journey) => {
    const rawPlatform = String(journey.stop?.platform || journey.stop?.prognosis?.platform || "").trim();
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

function renderProfile() {
  const username = currentUsername();
  document.body.classList.toggle("has-profile", Boolean(username));
  elements.profileName.textContent = username ? `Connecté: ${username}` : "Aucun profil";
  elements.logoutButton.hidden = !username;

  if (username) {
    elements.usernameInput.value = username;
    setProfileStatus("Profil actif. Les signalements seront associés à ce nom.");
  } else {
    setProfileStatus("Crée ou connecte un profil pour signaler un train.");
  }
}

function renderStation() {
  const platformTotal = state.platforms.size;
  const trainTotal = state.stationboard.filter((journey) => !isTrainHiddenForCurrentUser(journey)).length;

  elements.stationName.textContent = state.station?.name || "Aucune gare sélectionnée";
  elements.stationMeta.textContent =
    trainTotal > 0
      ? `${trainTotal} prochains trains visibles, ${platformTotal} quai${platformTotal > 1 ? "s" : ""} disponibles.`
      : "Aucun prochain départ en train n'a été trouvé.";
  elements.platformCount.textContent = `${platformTotal} quai${platformTotal > 1 ? "s" : ""}`;
  elements.drawPlatformButton.disabled = platformTotal === 0;
}

function renderDepartures() {
  const journeys = state.stationboard.slice(0, 18).filter((journey) => !isTrainHiddenForCurrentUser(journey));
  if (journeys.length === 0) {
    elements.departureList.innerHTML = `
      <article class="empty-state">
        Aucun train avec quai n'est disponible pour cette gare dans les prochains départs.
      </article>
    `;
    return;
  }

  elements.departureList.innerHTML = journeys
    .map((journey) => {
      const platform = normalizePlatform(journey.stop?.platform || journey.stop?.prognosis?.platform);
      const report = getVisibleReportForCurrentUser(journey);
      const reachableStops = getReachableStops(journey);
      const reportedByMe = isReportedByCurrentUser(report);
      const isReported = Boolean(report);
      const trainId = escapeHtml(journeyId(journey));
      const reportInfo = isReported
        ? `
          <div class="report-info">
            ${reportedByMe ? "Tu as signalé ce train comme supprimé." : "Ce train a été signalé comme supprimé."}
            ${
              reportedByMe
                ? ""
                : `<div class="report-actions">
                    <button type="button" data-action="confirm-report" data-train-id="${trainId}">Confirmer</button>
                    <button type="button" data-action="deny-report" data-train-id="${trainId}">Infirmer</button>
                  </div>`
            }
          </div>
        `
        : "";

      return `
        <article class="departure-item ${isReported ? "is-reported" : ""}">
          <span class="platform-badge">${escapeHtml(platform)}</span>
          <div class="departure-main">
            <strong>${escapeHtml(journeyTitle(journey))} → ${escapeHtml(journeyDestination(journey))}</strong>
            <span>${escapeHtml(journey.stop?.station?.name || state.station.name)}</span>
            <span>${reachableStops.length} arrêt${reachableStops.length > 1 ? "s" : ""} possibles</span>
            ${reportInfo}
          </div>
          <div class="departure-side">
            <time class="departure-time">${formatTime(journeyDeparture(journey))}</time>
            <button class="report-button" type="button" data-action="open-report" data-train-id="${trainId}" aria-label="Signaler ce train supprimé">!</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function resetDraws() {
  state.selectedJourney = null;
  state.selectedPlatform = null;
  elements.drawStopsButton.disabled = true;
  elements.stopCount.textContent = "0 arrêt";
  elements.trainResult.innerHTML = `
    <span class="result-kicker">Résultat</span>
    <strong>En attente du tirage</strong>
    <p>Tire un quai parmi les prochains trains compatibles.</p>
  `;
  elements.stopsPreview.textContent = "Sélectionne d'abord un train.";
}

async function selectStation(station) {
  if (!station) {
    setStatus("Aucune gare n'a été trouvée. Essaie un autre nom.", "error");
    return;
  }

  setLoading(true);
  resetDraws();
  setStatus(`Chargement des prochains trains pour ${station.name}...`);

  try {
    const board = await loadStationboard(station);
    await loadReports();
    state.station = station;
    state.stationboard = board;

    refreshDrawableState();
    updateMap(station, board);

    if (board.length === 0) {
      setStatus("Gare trouvée, mais aucun train n'est disponible dans les prochains départs.", "warning");
    } else {
      setStatus("Prêt. Tire un quai.");
    }
  } catch (error) {
    setStatus(error.message || "Impossible de charger les départs.", "error");
  } finally {
    setLoading(false);
  }
}

function drawPlatformAndTrain() {
  refreshDrawableState();
  const platforms = [...state.platforms.keys()];
  if (platforms.length === 0) {
    setStatus("Aucun train ne permet un trajet depuis cette gare.", "warning");
    return;
  }

  elements.drawPlatformButton.classList.add("is-spinning");
  elements.trainResult.innerHTML = `
    <span class="result-kicker">Tirage</span>
    <strong>Les aiguillages tournent...</strong>
    <p>Choix du quai actif puis d'un train compatible.</p>
  `;

  window.setTimeout(() => {
    const platform = randomItem(platforms);
    const platformJourneys = [...state.platforms.get(platform)].sort((a, b) =>
      (journeyDeparture(a) || "").localeCompare(journeyDeparture(b) || ""),
    );
    const journey = randomItem(platformJourneys);

    state.selectedPlatform = platform;
    state.selectedJourney = journey;
    elements.drawPlatformButton.classList.remove("is-spinning");
    elements.drawStopsButton.disabled = false;

    const reachableStops = getReachableStops(journey);
    elements.stopCount.textContent = `${reachableStops.length} arrêt${reachableStops.length > 1 ? "s" : ""}`;
    elements.trainResult.innerHTML = `
      <span class="result-kicker">Quai ${escapeHtml(platform)}</span>
      <strong>${escapeHtml(journeyTitle(journey))} → ${escapeHtml(journeyDestination(journey))}</strong>
      <div class="train-meta">
        <span class="train-chip">Départ ${formatTime(journeyDeparture(journey))}</span>
        <span class="train-chip">${reachableStops.length} arrêts possibles</span>
        <button class="report-button inline-report" type="button" data-action="open-report" data-train-id="${escapeHtml(journeyId(journey))}">Signaler supprimé</button>
      </div>
    `;
    elements.stopsPreview.textContent = "Le train est choisi. Tire maintenant le nombre d'arrêts.";
    updateMap(state.station, [journey]);
    drawJourneyRoute(journey);
  }, 520);
}

function getRemainingStops(journey) {
  const passList = journey?.passList || [];
  if (!passList.length) return [];

  const departureStationId = journey.stop?.station?.id || state.station?.id;
  const departureIndex = passList.findIndex((stop) => stop.station?.id === departureStationId);
  const startIndex = departureIndex >= 0 ? departureIndex + 1 : 1;

  return passList.slice(startIndex).filter((stop) => stop.station?.name);
}

function drawStops() {
  const reachableStops = getReachableStops(state.selectedJourney);
  if (reachableStops.length === 0) return;

  const count = Math.floor(Math.random() * reachableStops.length) + 1;
  const destinationStop = reachableStops[count - 1];
  const visibleStops = reachableStops.slice(0, Math.min(count, 5));

  elements.stopCount.textContent = `${count} arrêt${count > 1 ? "s" : ""}`;
  elements.stopsPreview.innerHTML = `
    <div class="stop-destination">
      <span class="result-kicker">Descendre après ${count} arrêt${count > 1 ? "s" : ""}</span>
      <strong>${escapeHtml(destinationStop.station.name)}</strong>
      <p>${destinationStop.arrival ? `Arrivée prévue à ${formatTime(destinationStop.arrival)}.` : "Garde un oeil sur les annonces à bord."}</p>
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
  `;

  drawJourneyRoute(state.selectedJourney, destinationStop);
}

function findJourneyById(trainId) {
  return state.stationboard.find((journey) => journeyId(journey) === trainId);
}

function openReportModal(trainId) {
  if (!currentUsername()) {
    setProfileStatus("Connecte ou crée un profil avant de signaler un train.", "warning");
    elements.usernameInput.focus();
    return;
  }

  const journey = findJourneyById(trainId);
  if (!journey) return;

  state.reportTarget = journey;
  elements.reportTitle.textContent = `${journeyTitle(journey)} → ${journeyDestination(journey)}`;
  elements.reportReason.value = "";
  elements.reportDuration.value = "";
  elements.reportModal.showModal();
}

async function submitReport(event) {
  event.preventDefault();
  if (!state.reportTarget) return;

  const journey = state.reportTarget;
  const durationValue = Number(elements.reportDuration.value);
  const durationMinutes = Number.isFinite(durationValue) && durationValue > 0 ? durationValue : null;

  try {
    await fetchLocalApi("/api/reports", {
      method: "POST",
      body: JSON.stringify({
        trainId: journeyId(journey),
        reportedBy: currentUsername(),
        reason: elements.reportReason.value,
        durationMinutes,
        trainTitle: journeyTitle(journey),
        destination: journeyDestination(journey),
        departureLabel: formatTime(journeyDeparture(journey)),
        stationName: state.station?.name,
      }),
    });

    elements.reportModal.close();
    await loadReports();
    resetDraws();
    refreshDrawableState();
    setStatus("Train signalé comme supprimé. Il est retiré de tes tirages.", "warning");
  } catch (error) {
    setStatus(error.message || "Signalement impossible.", "error");
  }
}

async function voteReport(trainId, action) {
  if (!currentUsername()) {
    setProfileStatus("Connecte ou crée un profil pour confirmer ou infirmer.", "warning");
    return;
  }

  try {
    await fetchLocalApi(`/api/reports/${encodeURIComponent(trainId)}/${action}`, {
      method: "POST",
      body: JSON.stringify({ username: currentUsername() }),
    });
    await loadReports();
    resetDraws();
    refreshDrawableState();
    setStatus(
      action === "confirm"
        ? "Merci, suppression confirmée. Ce train est retiré pour ton profil."
        : "Merci, information infirmée. L'alerte est masquée pour ton profil.",
    );
  } catch (error) {
    setStatus(error.message || "Action impossible.", "error");
  }
}

async function submitProfile(event, mode) {
  event.preventDefault();
  const username = elements.usernameInput.value.trim();
  const password = elements.passwordInput.value;
  const path = mode === "create" ? "/api/profiles" : "/api/sessions";

  try {
    const data = await fetchLocalApi(path, {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    state.profile = { username: data.username };
    localStorage.setItem("aletrainProfile", JSON.stringify(state.profile));
    elements.passwordInput.value = "";
    renderProfile();
    refreshDrawableState();
  } catch (error) {
    setProfileStatus(error.message || "Profil indisponible.", "error");
  }
}

function logoutProfile() {
  state.profile = null;
  localStorage.removeItem("aletrainProfile");
  renderProfile();
  refreshDrawableState();
}

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

elements.profileForm.addEventListener("submit", (event) => submitProfile(event, "login"));
elements.createProfileButton.addEventListener("click", (event) => submitProfile(event, "create"));
elements.loginProfileButton.addEventListener("click", (event) => submitProfile(event, "login"));
elements.logoutButton.addEventListener("click", logoutProfile);
elements.reportForm.addEventListener("submit", submitReport);
elements.closeReportModal.addEventListener("click", () => elements.reportModal.close());

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;

  const trainId = button.dataset.trainId;
  if (button.dataset.action === "open-report") openReportModal(trainId);
  if (button.dataset.action === "confirm-report") voteReport(trainId, "confirm");
  if (button.dataset.action === "deny-report") voteReport(trainId, "deny");
});

renderProfile();
loadReports();
initMap();
