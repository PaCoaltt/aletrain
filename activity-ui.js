import { chooseActivity, filterActivities, validActivityLocation, walkingMinutes } from "./activities-common.js";
import { setText } from './i18n.js';

const section = document.querySelector("#activitySection");
const intro = document.querySelector("#activityIntro");
const output = document.querySelector("#activityResult");
const button = document.querySelector("#drawActivityButton");
const category = document.querySelector("#activityCategory");
const minutes = document.querySelector("#activityMinutes");
const budget = document.querySelector("#activityBudget");
const categories = { walk: 'activity.walk', discover: 'activity.discover', food: 'activity.food' };
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
function setButton(key) { setText(button, key); }
function removeMarker() { window.dispatchEvent(new CustomEvent("aletrain:activity-selected", { detail: null })); }
function message(key) { setText(output, key); }

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
  delete output.dataset.i18n;
  delete output.dataset.i18nParams;
  removeMarker();
  section.hidden = !destination;
  setButton('activity.find');
  button.disabled = !validActivityLocation(destination?.coords);
  if (!destination) return;
  setText(intro, 'activity.near', { station: destination.name });
  if (button.disabled) message('activity.noCoords');
});

for (const field of [category, minutes, budget]) field.addEventListener("change", () => {
  revision++;
  removeMarker();
  message('activity.criteriaReady');
  setButton('activity.find');
  try { sessionStorage.setItem("aletrainActivityFilters", JSON.stringify(filters())); } catch { /* Optional persistence. */ }
});

function renderPlace(place) {
  const label = document.createElement("span");
  label.className = "result-kicker";
  setText(label, categories[place.category]);
  const name = document.createElement("strong");
  name.textContent = place.name;
  const walk = document.createElement("p");
  setText(walk, 'activity.walkTime', { minutes: Math.max(1, Math.ceil(walkingMinutes(destination.coords, place.coords))) });
  const note = document.createElement("p");
  note.className = "activity-note";
  const price = document.createElement('span');
  setText(price, place.category === 'food' ? 'activity.purchase' : place.free === true ? 'activity.free' : place.free === false ? 'activity.paid' : 'activity.unknownPrice');
  const check = document.createElement('span');
  setText(check, 'activity.check');
  note.append(price, document.createTextNode(' · '), check);
  const link = document.createElement("a");
  link.className = "map-link";
  link.href = `https://www.openstreetmap.org/${place.id}`;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  setText(link, 'activity.link');
  delete output.dataset.i18n;
  delete output.dataset.i18nParams;
  output.replaceChildren(label, name, walk, note, link);
  setButton('activity.another');
  window.dispatchEvent(new CustomEvent("aletrain:activity-selected", { detail: place }));
}

button.addEventListener("click", async () => {
  if (loading || !validActivityLocation(destination?.coords)) return;
  const currentGeneration = generation, currentRevision = revision;
  loading = true;
  button.disabled = true;
  output.setAttribute("aria-busy", "true");
  message('activity.searching');
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
      message('activity.empty');
      setButton('activity.find');
    }
  } catch {
    if (currentGeneration !== generation || currentRevision !== revision) return;
    message('activity.unavailable');
    setButton('retry');
  } finally {
    if (currentGeneration === generation) {
      loading = false;
      button.disabled = false;
      output.removeAttribute("aria-busy");
    }
  }
});
