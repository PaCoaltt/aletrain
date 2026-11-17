export const ADVENTURES = {
  train: ['train'],
  water: ['train', 'ship'],
  mountain: ['train', 'cableway'],
  all: ['train', 'tram', 'ship', 'bus', 'cableway'],
};

export function stopTime(stop, kind = 'departure') {
  return stop?.prognosis?.[kind] || stop?.[kind] || null;
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
