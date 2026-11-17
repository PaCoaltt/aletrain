import { readFile, copyFile, writeFile, rename } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';

// Never called by startup or Docker. Default is an inspection without mutation.
const args = process.argv.slice(2);
const fileIndex = args.indexOf('--file');
if (fileIndex < 0 || !args[fileIndex + 1] || args.some((arg, index) =>
  index !== fileIndex + 1 && !['--file', '--apply'].includes(arg))) {
  console.error('Usage: node scripts/cleanup-legacy-data.mjs --file /path/data.json [--apply]');
  process.exitCode = 1;
} else {
  const path = resolve(args[fileIndex + 1]);
  const original = await readFile(path, 'utf8');
  const data = JSON.parse(original);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Expected a JSON object');
  const keys = ['users', 'reports', 'telegramUpdateOffset'].filter(key => Object.hasOwn(data, key));
  console.log(JSON.stringify({ file: path, mode: args.includes('--apply') ? 'apply' : 'dry-run',
    users: Array.isArray(data.users) ? data.users.length : 0,
    reports: Array.isArray(data.reports) ? data.reports.length : 0, removedKeys: keys }));
  if (args.includes('--apply') && keys.length) {
    // Run only after approval, with the old server stopped. The backup retains private data.
    const backup = `${path}.backup-${Date.now()}`;
    await copyFile(path, backup, constants.COPYFILE_EXCL);
    for (const key of keys) delete data[key];
    const temporary = `${path}.cleanup-${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await rename(temporary, path);
    console.log(`Backup: ${backup}`);
  }
}
