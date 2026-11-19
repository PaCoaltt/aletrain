export const ADVENTURES = {
  train: ['train'],
  water: ['train', 'ship'],
  mountain: ['train', 'cableway'],
  all: ['train', 'tram', 'ship', 'bus', 'cableway'],
};

export function stopTime(stop, kind = 'departure') {
  const predicted = stop?.prognosis?.[kind];
  return Number.isFinite(Date.parse(predicted)) ? predicted : stop?.[kind] || null;
}

export function delayMinutes(stop, kind = 'departure') {
  if (typeof stop?.delay === 'number' && Number.isFinite(stop.delay)) return stop.delay;
  const planned = Date.parse(stop?.[kind]);
  const predicted = Date.parse(stop?.prognosis?.[kind]);
  return Number.isFinite(planned) && Number.isFinite(predicted) ? (predicted - planned) / 60000 : null;
}

export function hasPrediction(stop, kind = 'departure') {
  return Number.isFinite(Date.parse(stop?.prognosis?.[kind])) ||
    (typeof stop?.delay === 'number' && Number.isFinite(stop.delay));
}

export function platformFor(journey) {
  return String(journey.stop?.prognosis?.platform || journey.stop?.platform || '').trim();
}

export function cancelled(value) {
  return [value, value?.stop, value?.from, value?.to].some(item =>
    item?.cancelled === true || item?.canceled === true);
}

export function usableReturn(connection, earliest, deadline) {
  if (cancelled(connection) || !connection.sections?.length) return false;
  if (connection.sections.some(section => cancelled(section) || cancelled(section.journey) ||
    cancelled(section.departure) || cancelled(section.arrival))) return false;
  const departure = Date.parse(stopTime(connection.from));
  const arrival = Date.parse(stopTime(connection.to, 'arrival'));
  return Number.isFinite(departure) && Number.isFinite(arrival) &&
    departure >= earliest && arrival >= departure && arrival <= deadline;
}

export function swissDateTime(timestamp) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(timestamp)).map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

// Interpret the date/time control in Swiss time, including for visitors abroad.
export function swissTimestamp(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return NaN;
  const utc = Date.parse(`${value}:00Z`);
  for (const offset of [1, 2]) {
    const candidate = utc - offset * 3600000;
    const local = swissDateTime(candidate);
    if (`${local.date}T${local.time}` === value) return candidate;
  }
  return NaN;
}

const MINUTE = 60000;
const MAX_BOARDS = 10;
const MAX_BRANCHES = 80;

export function journeyStopTimestamp(stop, kind = 'departure') {
  const predicted = Date.parse(stop?.prognosis?.[kind]);
  if (Number.isFinite(predicted)) return predicted;
  return Date.parse(stopTime(stop, kind)) + (delayMinutes(stop, kind) ?? 0) * MINUTE;
}

function shuffle(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

function serviceIdentity(journey) {
  return JSON.stringify([journey.operator, journey.category, journey.number || journey.name, journey.to]);
}

function trainOptions(board, station, earliest, latest, deadline, visited, previous) {
  const options = [];
  for (const journey of board) {
    const departure = journeyStopTimestamp(journey.stop);
    if (cancelled(journey) || !Number.isFinite(departure) ||
        departure < earliest || departure > latest || departure >= deadline) continue;
    if (previous && serviceIdentity(journey) === serviceIdentity(previous.journey) &&
        Date.parse(journey.stop.departure) === Date.parse(previous.arrivalStop.departure)) continue;

    const from = journey.stop?.station;
    if (String(from?.id) !== String(station.id)) continue;
    const passList = journey.passList || [];
    const origin = passList.findIndex(stop => String(stop.station?.id) === String(station.id));
    const stops = [];
    const seen = new Set(visited);
    const exits = [];
    for (const stop of passList.slice(origin + 1)) {
      const id = stop.station?.id && String(stop.station.id);
      if (!id || cancelled(stop)) continue;
      if (seen.has(id)) break;
      seen.add(id);
      stops.push(stop);
      const arrival = journeyStopTimestamp(stop, 'arrival');
      if (!stop.station.name || !Number.isFinite(arrival) || arrival <= departure || arrival > deadline) continue;
      exits.push({ journey, from: { ...station, ...from }, arrivalStop: stop, departure, arrival, stops: [...stops] });
    }
    if (exits.length) options.push(shuffle(exits));
  }
  return shuffle(options);
}

export async function findRandomJourney(station, { trainCount, transferMinutes, maxTransferMinutes, maxMinutes, waitMinutes, startedAt }, loadBoard, signal) {
  if (!Number.isInteger(trainCount) || trainCount < 2 || trainCount > 5 ||
      ![transferMinutes, maxTransferMinutes, maxMinutes, waitMinutes, startedAt].every(Number.isFinite) ||
      transferMinutes < 0 || maxTransferMinutes < transferMinutes || maxMinutes <= 0 || waitMinutes <= 0) return null;
  const deadline = startedAt + maxMinutes * MINUTE;
  const minTransfer = transferMinutes * MINUTE;
  const maxTransfer = maxTransferMinutes * MINUTE;
  const firstLatest = startedAt + waitMinutes * MINUTE;
  const boards = new Map();
  let branches = 0;
  let requestError;

  async function search(from, earliest, latest, legs, visited) {
    signal?.throwIfAborted();
    if (earliest >= deadline || branches >= MAX_BRANCHES) return null;
    const key = JSON.stringify([String(from.id), legs.length ? Math.floor(earliest / MINUTE) : null]);
    if (!boards.has(key)) {
      if (boards.size >= MAX_BOARDS) return null;
      const board = await loadBoard(from, legs.length ? earliest : undefined).catch(error => {
        signal?.throwIfAborted();
        if (!legs.length) throw error;
        requestError = error;
        return [];
      });
      boards.set(key, board);
    }
    const options = trainOptions(boards.get(key), from, earliest, latest, deadline, visited, legs.at(-1));
    // Try one exit per train before spending more of the budget on the same train.
    for (let index = 0; options.some(exits => index < exits.length); index++) {
      for (const exits of options) {
        const leg = exits[index];
        if (!leg) continue;
        if (++branches > MAX_BRANCHES) return null;
        const path = [...legs, leg];
        if (path.length === trainCount) return path;
        const next = await search(leg.arrivalStop.station, leg.arrival + minTransfer, leg.arrival + maxTransfer, path,
          new Set([...visited, ...leg.stops.map(stop => String(stop.station.id))]));
        if (next) return next;
      }
    }
    return null;
  }

  const legs = await search(station, startedAt + 2 * MINUTE, firstLatest, [], new Set([String(station.id)]));
  if (!legs && requestError) throw requestError;
  return legs;
}
