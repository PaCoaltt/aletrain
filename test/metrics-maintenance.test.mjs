import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createVisitCounter } from '../visits.mjs';

test('persistent mode refuses missing or malformed statistics instead of resetting them', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aletrain-metrics-'));
  const path = join(directory, 'visits.json');
  try {
    await assert.rejects(createVisitCounter(path, { requireExisting: true }), /refusing to reset/);
    await writeFile(path, '{broken');
    await assert.rejects(createVisitCounter(path));
    assert.equal(await readFile(path, 'utf8'), '{broken');
    await writeFile(path, '{"visits":84}');
    const first = await createVisitCounter(path, { requireExisting: true });
    first.visit('');
    assert.equal(first.status().pendingWrite, true);
    await first.close();
    const restarted = await createVisitCounter(path, { requireExisting: true });
    assert.equal(restarted.count(), 85);
    assert.equal(restarted.visit('aletrain_visit=1'), 85);
    await restarted.close();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('offline import refuses overwrites and explicit restore preserves the previous count', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aletrain-import-'));
  try {
    const path = join(directory, 'visits.json'), source = join(directory, 'source.json');
    await writeFile(source, '{"visits":123,"storage":"ok"}');
    const run = args => spawnSync(process.execPath, [resolve('scripts/metrics-store.mjs'), ...args], { encoding: 'utf8' });
    assert.notEqual(run(['init', '--file', path]).status, 0);
    assert.equal(run(['import', '--file', path, '--source', source]).status, 0);
    assert.equal(JSON.parse(await readFile(path, 'utf8')).visits, 123);
    await writeFile(source, '{"visits":456}');
    assert.notEqual(run(['import', '--file', path, '--source', source]).status, 0);
    assert.equal(JSON.parse(await readFile(path, 'utf8')).visits, 123);
    assert.equal(run(['import', '--file', path, '--source', source, '--replace']).status, 0);
    assert.equal(JSON.parse(await readFile(path, 'utf8')).visits, 456);
    const backup = (await readdir(directory)).find(file => file.startsWith('visits.json.backup-'));
    assert.equal(JSON.parse(await readFile(join(directory, backup), 'utf8')).visits, 123);
    assert.notEqual(run(['init', '--file', path, '--new']).status, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
