import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { catalogs, detectLanguage, translate } from '../i18n.js';

test('all five catalogs have every French key and the same interpolation parameters', () => {
  const params = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
  for (const [lang, dictionary] of Object.entries(catalogs)) {
    assert.deepEqual(Object.keys(dictionary).sort(), Object.keys(catalogs.fr).sort(), lang);
    for (const [key, text] of Object.entries(dictionary)) {
      assert.ok(text.trim(), `${lang}.${key}`);
      assert.deepEqual(params(text), params(catalogs.fr[key]), `${lang}.${key}`);
    }
  }
});

test('preference wins; compatible browser languages are detected, otherwise French', () => {
  assert.equal(detectLanguage('en', ['de-CH']), 'en');
  assert.equal(detectLanguage(null, ['rm-CH', 'it-CH', 'en-US']), 'it');
  assert.equal(detectLanguage('invalid', ['de-CH']), 'de');
  assert.equal(detectLanguage(null, ['es-ES']), 'fr');
  assert.equal(detectLanguage(null, []), 'fr');
  assert.equal(detectLanguage(null, ['gsw-CH']), 'gsw');
  assert.equal(detectLanguage(null, ['de-CH']), 'de');
  assert.equal(detectLanguage('gsw', ['fr-CH']), 'gsw');
  assert.equal(translate('gsw', 'missing', {}, { gsw: {}, de: { missing: 'Deutsch' }, fr: { missing: 'Français' } }), 'Deutsch');
  assert.equal(translate('gsw', 'missing', {}, { gsw: {}, de: {}, fr: { missing: 'Français' } }), 'Français');
  assert.equal(translate('de', 'missing', {}, { fr: { missing: 'Référence' }, de: {} }), 'Référence');
});

test('plural rules, nested plurals and numbers are localized without altering station names', () => {
  assert.equal(translate('de', 'stops.other', { count: 1 }), '1 Halt');
  assert.equal(translate('en', 'stops.one', { count: 0 }), '0 stops');
  assert.equal(translate('it', 'stops.other', { count: 2 }), '2 fermate');
  assert.equal(translate('en', 'visits.other', { count: 12345 }), '12,345 visits');
  assert.equal(translate('de', 'exit.after', { stops: { key: 'stops', count: 2 } }), 'Aussteigen · 2 Halte ab Start');
  assert.equal(translate('it', 'return.to', { station: 'Zürich HB' }), 'Ritorno a Zürich HB');
});

test('language selector updates text, attributes, document lang and preference immediately', async () => {
  const source = (await readFile(new URL('../i18n.js', import.meta.url), 'utf8'))
    .replace(/^import .*\r?\n/gm, '').replaceAll('export ', '');
  const events = [], stored = [], listeners = {};
  const select = { value: '', addEventListener: (type, handler) => { listeners[type] = handler; } };
  const text = { dataset: { i18n: 'return.to', i18nParams: JSON.stringify({ station: 'Zürich HB' }) }, textContent: '' };
  const count = { dataset: { i18n: 'visits.other', i18nParams: '{"count":1}' }, textContent: '' };
  const aria = { attributes: { 'data-i18n-aria-label': 'search' },
    getAttribute(name) { return this.attributes[name]; }, setAttribute(name, value) { this.attributes[name] = value; } };
  const document = {
    documentElement: { lang: 'fr' }, querySelector: () => select,
    querySelectorAll: selector => selector === '[data-i18n]' ? [text, count] : selector === '[data-i18n-aria-label]' ? [aria] : [],
  };
  const context = vm.createContext({ ...catalogs, Intl, document, navigator: { languages: ['it-CH'] },
    localStorage: { getItem: () => null, setItem: (...args) => stored.push(args) },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    window: { dispatchEvent: event => events.push(event) },
  });
  vm.runInContext(source, context);
  assert.equal(document.documentElement.lang, 'it');
  assert.equal(text.textContent, 'Ritorno a Zürich HB');
  assert.equal(count.textContent, '1 visita');
  listeners.change({ target: { value: 'en' } });
  assert.equal(document.documentElement.lang, 'en');
  assert.equal(text.textContent, 'Return to Zürich HB');
  assert.equal(count.textContent, '1 visit');
  assert.equal(aria.attributes['aria-label'], 'Search for a station');
  assert.deepEqual(stored, [['aletrainLanguage', 'en']]);
  assert.equal(events.at(-1).detail, 'en');
});

test('all static UI text is translatable except proper names, language names and symbols', async () => {
  const source = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const allowed = new Set(['alétrain', 'alétrain.', '.', '+', '01', '02', '03', '→', 'CH',
    'Français', 'Deutsch', 'Schwiizerdütsch', 'Italiano', 'English', 'opentransportdata.swiss', 'transport.opendata.ch', 'Visites : ...']);
  for (const match of source.matchAll(/([^>]+)>([^<>]+)</g)) {
    const text = match[2].trim();
    if (!text || allowed.has(text)) continue;
    assert.match(match[1], /data-i18n(?:=|-)/, text);
  }
});
