import { constants } from 'node:fs';
import { mkdir, open, lstat, realpath, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

async function privateParent(path) {
  if (!isAbsolute(path) || resolve(path) !== path) throw new Error('absolute_normalized_path_required');
  const parent = dirname(path), s = await lstat(parent);
  if (!s.isDirectory() || (s.mode & 0o077) !== 0 || s.uid !== process.getuid() || await realpath(parent) !== parent) throw new Error('private_owned_parent_required');
}
export async function saveDotGrant(path, token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{32,512}$/.test(token)) throw new Error('invalid_dot_grant');
  await privateParent(path);
  const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(token + '\n'); await file.sync(); } finally { await file.close(); }
}
export async function prepareDotPackage(path, appId) {
  if (!/^plugin_asdk_app_[A-Za-z0-9]+$/.test(appId ?? '')) throw new Error('registered_plugin_id_required');
  await privateParent(path); await mkdir(path, { mode: 0o700 }); // No overwrite/merge of an existing package.
  const source = fileURLToPath(new URL('../plugins/webjjoku-dot/', import.meta.url));
  for (const name of ['plugin.json', 'README.md']) await writeFile(join(path, name), await readFile(join(source, name)), { flag: 'wx', mode: 0o600 });
  await writeFile(join(path, '.app.json'), JSON.stringify({ apps: { 'webjjoku-dot': { id: appId } } }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return { status: 'PREPARED', installed: 'UNVERIFIED', authentication: 'UNVERIFIED' };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [action, path, appId, extra] = process.argv.slice(2);
    if (extra || !path) throw new Error('usage');
    if (action === 'save-grant' && !appId) {
      let input = ''; for await (const chunk of process.stdin) { input += chunk; if (Buffer.byteLength(input) > 1024) throw new Error('invalid_dot_grant'); }
      await saveDotGrant(path, input.trim()); console.log('Dot grant saved privately. Existing files were not replaced.');
    } else if (action === 'package') console.log(JSON.stringify(await prepareDotPackage(path, appId)));
    else throw new Error('usage');
  } catch { console.error('Dot setup not completed. Check the new absolute path, private parent permissions, and input. No secret is printed.'); process.exitCode = 1; }
}
