import { spawn } from 'node:child_process';
import { mkdir, access } from 'node:fs/promises';
import { loadWorkspaceConfig } from '../dist/server/workspace/config.js';
const config = loadWorkspaceConfig(); const children = []; let stopping = false;
if (process.platform !== 'linux' || process.getuid?.() === 0) throw new Error('Run the Chrome desktop as an ordinary Ubuntu user.');
const chrome = process.env.WJ_CHROME_BINARY; if (!chrome?.startsWith('/')) throw new Error('Set WJ_CHROME_BINARY to the installed Chrome executable.');
await access(chrome); await mkdir(config.chromeProfileDir, { recursive: true, mode: 0o700 });
await access(process.env.WJ_NOVNC_WEB ?? '/usr/share/novnc');
// Refuse an occupied display before launching any process; never attach our
// Chrome/VNC to a desktop that another service owns.
for (const path of ['/tmp/.X11-unix/X99', '/tmp/.X99-lock']) {
  try { await access(path); throw new Error('Display :99 is already in use. Inspect the existing desktop before starting this service.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const display = ':99'; const env = { ...process.env, DISPLAY: display };
// Core/provider secrets do not belong in Chrome or VNC child environments.
for (const key of Object.keys(env)) if (/^(WJ_|OPENAI_API_KEY|DEEPSEEK_API_KEY|CONTROL_PLANE_API_KEY)/.test(key)) delete env[key];
function start(command, args) {
  const child = spawn(command, args, { env, shell: false, stdio: ['ignore', 'ignore', 'ignore'] }); children.push(child);
  child.once('error', () => stop(1)); child.once('exit', () => { if (!stopping) stop(1); }); return child;
}
function stop(code = 0) { if (stopping) return; stopping = true; process.exitCode = code; for (const child of children.toReversed()) child.kill('SIGTERM'); }
process.on('SIGTERM', () => stop()); process.on('SIGINT', () => stop());
start('Xvfb', [display, '-screen', '0', '1600x1000x24', '-nolisten', 'tcp']);
// Wait for the local X socket, not a fixed sleep before sending work.
let ready = false; for (let attempt = 0; attempt < 50 && !stopping; attempt++) { try { await access('/tmp/.X11-unix/X99'); ready = true; break; } catch { await new Promise(r => setTimeout(r, 100)); } }
if (!ready) { stop(1); throw new Error('X display did not start.'); }
if (!stopping) {
  start(chrome, [`--user-data-dir=${config.chromeProfileDir}`, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9222', '--no-first-run', '--disable-session-crashed-bubble', '--window-size=1600,1000', 'about:blank']);
  start('x11vnc', ['-display', display, '-localhost', '-rfbport', '5901', '-forever', '-shared', '-nopw']);
  start('websockify', [`--web=${process.env.WJ_NOVNC_WEB ?? '/usr/share/novnc'}`, `127.0.0.1:${config.noVncPort ?? 6080}`, '127.0.0.1:5901']);
  console.log('Chrome display started on loopback. Open it through the authenticated /browser/ gateway.');
}
