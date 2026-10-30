import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
const run = promisify(execFile);

test('installed services resolve env-based Node tools without the interactive nvm PATH', async t => {
  const home = await mkdtemp(join(tmpdir(), 'wj-service-install-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const bin = join(home, 'bin');
  await mkdir(bin);
  await writeFile(join(bin, 'systemctl'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  await run(process.execPath, ['scripts/ops.mjs', 'install'], { env: { ...process.env, HOME: home, PATH: bin } });
  for (const name of ['webjjoku', 'webjjoku-desktop']) {
    const file = join(home, '.config/systemd/user', `${name}.service`);
    const unit = await readFile(file, 'utf8');
    await run('/usr/bin/systemd-analyze', ['verify', file]);
    const path = /^Environment="PATH=([^"]+)"$/m.exec(unit)?.[1];
    assert.ok(path, 'service must have an explicit tool PATH');
    assert.equal(path.split(':')[0], dirname(process.execPath));
    const child = await run('/usr/bin/env', ['node', '-p', 'process.execPath'], { env: { PATH: path } });
    assert.equal(child.stdout.trim(), process.execPath);
    assert.match(unit, /^NoNewPrivileges=true$/m);
  }
});
