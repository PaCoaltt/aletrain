import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Compose preserves the isolated service, external metrics volume, port and healthcheck', async () => {
  // Static contract check, not a substitute for `docker compose config` on Docker.
  const compose = await readFile('compose.yaml', 'utf8');
  assert.match(compose, /^name: aletrain$/m);
  assert.match(compose, /container_name: aletrain/);
  assert.match(compose, /restart: unless-stopped/);
  assert.match(compose, /"4173:4173"/);
  assert.match(compose, /external: true/);
  assert.match(compose, /metrics:\/data/);
  assert.match(compose, /REQUIRE_VISITS_FILE: "1"/);
  assert.match(compose, /api\/health/);
  assert.match(compose, /read_only: true/);
  assert.doesNotMatch(compose, /docker\.sock|privileged:\s*true|network_mode:\s*host/);
  const dockerfile = await readFile('Dockerfile', 'utf8');
  assert.match(dockerfile, /USER node/);
  assert.match(dockerfile, /EXPOSE 4173/);
  const workflow = await readFile('.github/workflows/docker-image.yml', 'utf8');
  assert.match(workflow, /linux\/amd64,linux\/arm64/);
  assert.match(workflow, /APP_REVISION=\$\{\{ github.sha \}\}/);
});
