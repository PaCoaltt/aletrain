// Explicit offline maintenance only. Never called by application startup.
import { readFile, writeFile, mkdir, copyFile, rename } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, dirname } from 'node:path';

const [command, ...args] = process.argv.slice(2);
const allowed = new Set(['--file', '--source', '--new', '--replace']);
const options = {};
for (let i = 0; i < args.length; i++) {
  if (!allowed.has(args[i])) throw new Error(`Unknown option: ${args[i]}`);
  const key = args[i].slice(2);
  if (Object.hasOwn(options, key)) throw new Error(`Duplicate option: ${args[i]}`);
  if (!['new', 'replace'].includes(key) && (!args[i + 1] || args[i + 1].startsWith('--'))) throw new Error(`Missing value: ${args[i]}`);
  options[key] = ['new', 'replace'].includes(key) ? true : args[++i];
}
if (!['inspect', 'init', 'import'].includes(command) || !options.file) {
  throw new Error('Usage: metrics-store.mjs inspect|init|import --file PATH [--new] [--source PATH] [--replace]');
}
const path = resolve(options.file);
async function readCount(file) {
  const data = JSON.parse(await readFile(file, 'utf8'));
  if (!Number.isSafeInteger(data?.visits) || data.visits < 0) throw new Error(`Invalid visits file: ${file}. No statistics were reset.`);
  return data.visits;
}
if (command === 'inspect') {
  console.log(JSON.stringify({ file: path, visits: await readCount(path) }));
} else {
  if (command === 'init' && !options.new) throw new Error('Explicit --new is required to initialize a new counter.');
  if (command === 'init' && options.replace) throw new Error('Initialization never replaces existing statistics.');
  if (command === 'import' && (!options.source || resolve(options.source) === path)) throw new Error('A different source file is required.');
  const visits = command === 'init' ? 0 : await readCount(resolve(options.source));
  let existing = false;
  try { await readFile(path); existing = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing && !options.replace) throw new Error('Destination exists. Inspect it first; replacement requires --replace.');
  await mkdir(dirname(path), { recursive: true });
  if (existing) {
    const backup = `${path}.backup-${Date.now()}`;
    await copyFile(path, backup, constants.COPYFILE_EXCL);
    console.log(`Preserved previous file: ${backup}`);
  }
  // Refuse even a concurrent creation; maintenance must run with AleTrain stopped.
  const temporary = `${path}.import-${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ visits })}\n`, { flag: 'wx', mode: 0o600 });
  if (existing) await rename(temporary, path);
  else {
    await copyFile(temporary, path, constants.COPYFILE_EXCL);
    const { unlink } = await import('node:fs/promises');
    await unlink(temporary);
  }
  console.log(JSON.stringify({ file: path, visits, action: command }));
}
