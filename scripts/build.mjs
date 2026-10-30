import { spawnSync } from 'node:child_process';
import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const compiler = fileURLToPath(new URL('node_modules/typescript/bin/tsc', root));
if (Number(process.versions.node.split('.')[0]) !== 24) {
  console.error('Webjjoku requires Node.js 24.x.');
  process.exit(1);
}
await rm(new URL('dist/', root), { recursive: true, force: true });
for (const config of ['tsconfig.server.json', 'tsconfig.web.json']) {
  const result = spawnSync(process.execPath, [compiler, '-p', config], {
    cwd: root, stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
await mkdir(new URL('dist/client/web/', root), { recursive: true });
await cp(new URL('src/connections/browser-presets/', root), new URL('dist/server/connections/browser-presets/', root), { recursive: true });
for (const file of ['index.html', 'styles.css', 'control.html', 'control.css']) {
  await cp(new URL(`src/web/${file}`, root), new URL(`dist/client/web/${file}`, root));
}
console.log('Built server and discussion workspace.');
