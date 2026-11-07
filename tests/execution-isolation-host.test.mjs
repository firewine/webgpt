import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync, writeFileSync, lstatSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HOST, main, compileProfile, assertNode, assertElf, assertChecksum, assertConffile, assertStockPolicy, assertProfileList, assertIdleProcesses } from '../scripts/execution-isolation-host.mjs';
const script = new URL('../scripts/execution-isolation-host.mjs', import.meta.url);
const policy = readFileSync(new URL('../scripts/fixtures/webjjoku-outer-bwrap.apparmor', import.meta.url), 'utf8');
const md5 = bytes => createHash('md5').update(bytes).digest('hex');
test('installed parser compiles verified stdin bytes without treating a dash as a filename', { skip: !existsSync('/usr/sbin/apparmor_parser') }, () => {
  assert.doesNotThrow(() => compileProfile(Buffer.from('abi <abi/3.0>,\nprofile wj_r6_compile_test { /bin/true ix, }\n')));
});
test('temporary-fixture checks reject unsafe ownership, modes, aliases and executable copies', t => {
  const dir = mkdtempSync(join(tmpdir(), 'wj-host-check-')); t.after(() => rmSync(dir, { recursive: true }));
  const file = join(dir, 'binary'); writeFileSync(file, 'fixture', { mode: 0o750 });
  const st = lstatSync(file); const safe = { ...st, uid: 0, gid: 1000, mode: 0o100750, nlink: 1,
    isSymbolicLink: () => false, isFile: () => true, isDirectory: () => false };
  assert.doesNotThrow(() => assertNode(safe, 'file', 0o750, 1000));
  assert.throws(() => assertNode({ ...safe, nlink: 116 }, 'file'), /untrusted_file_or_parent/);
  assert.doesNotThrow(() => assertNode({ ...safe, nlink: 116 }, 'file', undefined, undefined, true));
  assert.throws(() => assertNode({ ...safe, uid: 1000, nlink: 116 }, 'file', undefined, undefined, true), /untrusted_file_or_parent/);
  for (const change of [{ uid: 1000 }, { gid: 0 }, { mode: 0o100770 }, { mode: 0o104750 }, { nlink: 2 }, { isSymbolicLink: () => true }]) {
    assert.throws(() => assertNode({ ...safe, ...change }, 'file', 0o750, 1000), /untrusted_file_or_parent/);
  }
  const elf = Buffer.alloc(64); elf.write('7f454c46', 'hex'); elf[4] = 2; elf[5] = 1; elf.writeUInt16LE(3, 16);
  assert.doesNotThrow(() => assertElf(elf)); assert.throws(() => assertElf(readFileSync(file)), /native_elf/);
  assertChecksum(elf, `${md5(elf)}  usr/bin/bwrap\n`, HOST.stock);
  for (const sums of ['', `${md5(elf)}  usr/bin/other`, `${'0'.repeat(32)}  usr/bin/bwrap`]) assert.throws(() => assertChecksum(elf, sums, HOST.stock), /package_binary_mismatch/);
});
test('stock protection must be packaged, present and enforcing; no local capability relaxation', () => {
  const stock = 'profile bwrap /usr/bin/bwrap flags=(x) {\n allow pix /** -> &bwrap//&unpriv_bwrap,\n}\nprofile unpriv_bwrap flags=(x) {\n audit deny capability,\n}';
  assertStockPolicy(stock);
  assert.throws(() => assertStockPolicy(stock.replace('audit deny capability,', 'allow capability,')), /unsupported_stock_policy/);
  assertConffile(Buffer.from(stock), ` ${HOST.stockPolicy} ${md5(stock)}\n`, HOST.stockPolicy);
  assert.throws(() => assertConffile(Buffer.from(stock + 'changed'), ` ${HOST.stockPolicy} ${md5(stock)}`, HOST.stockPolicy), /package_mismatch/);
  const list = 'bwrap (enforce)\nunpriv_bwrap (enforce)\n';
  assertProfileList(list, false); assertProfileList(`${list}${HOST.name} (enforce)\n`, true);
  for (const text of [list, `${list}${HOST.name} (complain)\n`, `${list}${HOST.name} (enforce)\n${HOST.name}//child (enforce)\n`]) assert.throws(() => assertProfileList(text, true), /unexpected_loaded_profile/);
  assert.throws(() => assertProfileList(list.replace('unpriv_bwrap (enforce)', 'unpriv_bwrap (complain)'), false), /stock_profile_not_enforcing/);
});
test('remove refuses live dedicated binaries, deleted mappings and stacked descendants', () => {
  assertIdleProcesses([{ exe: '/usr/bin/other', label: 'unconfined' }]);
  for (const process of [{ exe: HOST.binary, label: 'unconfined' }, { exe: `${HOST.binary} (deleted)`, label: '' }, { exe: '/bin/sh', label: `${HOST.name}//&bwrap//&unpriv_bwrap (enforce)` }]) assert.throws(() => assertIdleProcesses([process]), /still_running/);
});
test('commands are fixed; import and invalid invocation never install or invoke sudo', () => {
  const source = readFileSync(script, 'utf8');
  assert.equal(source.includes(createHash('sha256').update(policy).digest('hex')), true);
  assert.match(source, /compileProfile\(ctx.approved\)/);
  assert.equal(source.includes("parse('--replace'"), false);
  assert.throws(() => main(['install', '--path=/tmp/elsewhere']), /Usage:/);
  if (process.getuid() !== 0) {
    assert.throws(() => main(['install']), /administrator_required/);
    assert.throws(() => main(['remove']), /administrator_required/);
  }
});
