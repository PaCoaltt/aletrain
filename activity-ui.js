import { chooseActivity, filterActivities, validActivityLocation, walkingMinutes } from "./activities-common.js";

const section = document.querySelector("#activitySection");
const intro = document.querySelector("#activityIntro");
const output = document.querySelector("#activityResult");
const button = document.querySelector("#drawActivityButton");
const category = document.querySelector("#activityCategory");
const minutes = document.querySelector("#activityMinutes");
const budget = document.querySelector("#activityBudget");
const categories = { walk: "Se balader", discover: "Découvrir", food: "Manger ou boire" };
let destination = null, places = null, controller = null;
let revision = 0, generation = 0, loading = false;
const seen = new Set();

try {
  const saved = JSON.parse(sessionStorage.getItem("aletrainActivityFilters") || "null");
  if (["all", "walk", "discover", "food"].includes(saved?.category)) category.value = saved.category;
  if ([10, 20, 30].includes(saved?.minutes)) minutes.value = String(saved.minutes);
  if (["any", "free"].includes(saved?.budget)) budget.value = saved.budget;
} catch { /* Storage may be unavailable. Defaults remain usable. */ }

function filters() { return { category: category.value, minutes: Number(minutes.value), budget: budget.value }; }
function setButton(label) { button.replaceChildren(document.createTextNode(label)); }
function removeMarker() { window.dispatchEvent(new CustomEvent("aletrain:activity-selected", { detail: null })); }
function message(text) { output.replaceChildren(document.createTextNode(text)); }

window.addEventListener("aletrain:destination", event => {
  generation++;
  revision++;
  controller?.abort();
  destination = event.detail;
  places = null;
  seen.clear();
  loading = false;
  output.removeAttribute("aria-busy");
  output.replaceChildren();
  removeMarker();
  section.hidden = !destination;
  setButton("Trouver une idée");
  button.disabled = !validActivityLocation(destination?.coords);
  if (!destination) return;
  intro.textContent = `Une idée près de ${destination.name}, pour prolonger le voyage.`;
  if (button.disabled) message("Les coordonnées de cette gare ne sont pas disponibles pour chercher une sortie.");
});

for (const field of [category, minutes, budget]) field.addEventListener("change", () => {
  revision++;
  removeMarker();
  message("Tes critères sont prêts. Tire une nouvelle idée.");
  setButton("Trouver une idée");
  try { sessionStorage.setItem("aletrainActivityFilters", JSON.stringify(filters())); } catch { /* Optional persistence. */ }
});

function renderPlace(place) {
  const label = document.createElement("span");
  label.className = "result-kicker";
  label.textContent = categories[place.category];
  const name = document.createElement("strong");
  name.textContent = place.name;
  const walk = document.createElement("p");
  walk.textContent = `Environ ${Math.max(1, Math.ceil(walkingMinutes(destination.coords, place.coords)))} min à pied — estimation`;
  const note = document.createElement("p");
  note.className = "activity-note";
  note.textContent = `${place.category === "food" ? "Consommation à prévoir" : place.free === true ? "Indiqué gratuit" : place.free === false ? "Entrée payante indiquée" : "Tarif non renseigné"} · Horaires et tarifs à vérifier sur la fiche du lieu.`;
  const link = document.createElement("a");
  link.className = "map-link";
  link.href = `https://www.openstreetmap.org/${place.id}`;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "Voir le lieu sur OpenStreetMap ↗";
  output.replaceChildren(label, name, walk, note, link);
  setButton("Une autre idée");
  window.dispatchEvent(new CustomEvent("aletrain:activity-selected", { detail: place }));
}

button.addEventListener("click", async () => {
  if (loading || !validActivityLocation(destination?.coords)) return;
  const currentGeneration = generation, currentRevision = revision;
  loading = true;
  button.disabled = true;
  output.setAttribute("aria-busy", "true");
  message("À la recherche d’une idée près de ta gare…");
  removeMarker();
  try {
    if (places === null) {
      const requestController = new AbortController();
      controller = requestController;
      const timer = setTimeout(() => requestController.abort(), 35000);
      let response;
      try {
        response = await fetch("/api/activities", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ location: destination.coords }), signal: requestController.signal,
        });
        if (!response.ok) throw new Error("Unavailable");
        const data = await response.json();
        if (!Array.isArray(data.activities)) throw new Error("Invalid data");
        if (currentGeneration !== generation) return;
        places = data.activities.filter(place => typeof place.name === "string" &&
          /^(node|way|relation)\/\d+$/.test(place.id) && validActivityLocation(place.coords) && categories[place.category]);
      } finally { clearTimeout(timer); }
    }
    if (currentGeneration !== generation || currentRevision !== revision) return;
    const place = chooseActivity(filterActivities(places, destination.coords, filters()), seen);
    if (place) renderPlace(place);
    else {
      message("Aucun lieu ne correspond à ces critères dans les données disponibles. Essaie d’élargir la marche ou de changer tes filtres.");
      setButton("Trouver une idée");
    }
  } catch {
    if (currentGeneration !== generation || currentRevision !== revision) return;
    message("Les idées de sortie sont indisponibles pour le moment. Réessaie dans un instant.");
    setButton("Réessayer");
  } finally {
    if (currentGeneration === generation) {
      loading = false;
      button.disabled = false;
      output.removeAttribute("aria-busy");
    }
  }
});
