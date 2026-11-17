import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('cleanup defaults to dry-run; explicit apply backs up and preserves unrelated data', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aletrain-cleanup-test-'));
  try {
    const path = join(directory, 'data.json');
    const original = JSON.stringify({ users: [{ username: 'fixture', passwordHash: 'test-only' }],
      reports: [{ reason: 'fixture' }], telegramUpdateOffset: 3, shared: { keep: true } });
    await writeFile(path, original);
    const script = resolve('scripts/cleanup-legacy-data.mjs');
    const inspect = spawnSync(process.execPath, [script, '--file', path], { encoding: 'utf8' });
    assert.equal(inspect.status, 0, inspect.stderr);
    assert.match(inspect.stdout, /dry-run/);
    assert.doesNotMatch(inspect.stdout, /fixture|test-only|passwordHash/);
    assert.equal(await readFile(path, 'utf8'), original);
    assert.equal((await readdir(directory)).length, 1);
    // Only disposable test fixtures are cleaned here; never the application's data.json.
    const apply = spawnSync(process.execPath, [script, '--file', path, '--apply'], { encoding: 'utf8' });
    assert.equal(apply.status, 0, apply.stderr);
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { shared: { keep: true } });
    const backup = (await readdir(directory)).find(name => name.startsWith('data.json.backup-'));
    assert.ok(backup);
    assert.equal(await readFile(join(directory, backup), 'utf8'), original);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
