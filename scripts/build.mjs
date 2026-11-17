// Buildless HTML/ES modules: validate the exact assets served in production.
import { readFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { catalogs } from '../i18n.js';

const reference = Object.keys(catalogs.fr).sort();
const parameters = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
for (const [lang, dictionary] of Object.entries(catalogs)) {
  if (JSON.stringify(Object.keys(dictionary).sort()) !== JSON.stringify(reference)) throw new Error(`Incomplete catalog: ${lang}`);
  for (const key of reference) {
    if (!dictionary[key] || JSON.stringify(parameters(dictionary[key])) !== JSON.stringify(parameters(catalogs.fr[key]))) throw new Error(`Invalid translation: ${lang}.${key}`);
  }
}
const html = await readFile('index.html', 'utf8');
for (const match of html.matchAll(/data-i18n(?:-(?:aria-label|title|placeholder|content))?="([^"]+)"/g)) {
  if (!catalogs.fr[match[1]]) throw new Error(`Unknown HTML translation: ${match[1]}`);
}
const queue = ['server.mjs', ...[...html.matchAll(/(?:src|href)="([^"#]+)"/g)]
  .map(match => match[1].split('?')[0]).filter(path => !/^(https?:|\/)/.test(path))];
const checked = new Set();
while (queue.length) {
  const file = resolve(queue.pop());
  if (checked.has(file)) continue;
  checked.add(file);
  await access(file);
  if (!/\.(mjs|js)$/.test(file) || file.includes('vendor')) continue;
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  const source = await readFile(file, 'utf8');
  for (const match of source.matchAll(/(?:from\s*|import\s*\()['"](\.[^'"]+)['"]/g)) queue.push(resolve(dirname(file), match[1].split('?')[0]));
}
console.log(`Production assets validated: ${checked.size} files; ${reference.length} messages in ${Object.keys(catalogs).length} languages. No bundling or native dependencies required.`);
