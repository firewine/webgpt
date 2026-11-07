import test from 'node:test';
import assert from 'node:assert/strict';
import { createScopedApproval, scopedApprovalDigest, validateScopedApproval } from '../dist/server/execution/approval-policy.js';
import { AppError, digest } from '../dist/server/workspace/util.js';

const METHOD = 'item/commandExecution/requestApproval';
const COMMAND = '/bin/bash -c \'cat validation.txt\'';
const CWD = '/fixture/worktree';
const rule = { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['/bin/bash', '-c', 'cat validation.txt'] } };
function input(overrides = {}, params = {}) {
  return { jobId: 'job-a', threadId: 'thread-a', turnId: 'turn-a', rpcId: 17, method: METHOD,
    contextDigest: digest('context'), displayCommand: COMMAND, cwd: CWD, profileId: 'webjjoku_read',
    params: { kind: 'command', threadId: 'thread-a', turnId: 'turn-a', itemId: 'item-a',
      startedAtMs: 1_794_009_600_000, environmentId: 'local', command: COMMAND, cwd: CWD,
      commandActions: [{ type: 'read', command: 'cat validation.txt', name: 'validation.txt', path: 'validation.txt' }],
      proposedExecpolicyAmendment: ['/bin/bash', '-c', 'cat validation.txt'],
      availableDecisions: ['accept', rule, 'cancel'], reason: null, approvalId: null, ...params }, ...overrides };
}
const choice = delivery => ({ commandId: 'owner-command-a', selectedAt: '2026-11-07T12:00:00.000Z', delivery });
const seal = scope => ({ ...scope, digest: scopedApprovalDigest(scope) });
function invalid(scope) {
  assert.throws(() => validateScopedApproval(scope), error => error instanceof AppError &&
    error.code === 'invalid_scoped_approval_state' && error.status === 503);
}
function blocked(request) {
  const scope = createScopedApproval(request);
  assert.equal(scope.state, 'blocked');
  assert.match(scope.reason, /^scoped_approval_[a-z_]+$/);
  assert.equal(scope.command, request.displayCommand);
  assert.equal(scope.cwd, request.cwd);
  assert.equal(scope.requestDigest, digest(JSON.stringify({ jobId: request.jobId, rpcId: request.rpcId,
    method: request.method, params: request.params })));
  assert.doesNotThrow(() => validateScopedApproval(scope));
  return scope;
}

test('native command approval starts checking with a deterministic raw request digest and visible-field seal', () => {
  for (const profileId of ['webjjoku_read', 'webjjoku_copy']) {
    const request = input({ profileId });
    const before = structuredClone(request);
    const scope = createScopedApproval(request);
    const requestDigest = digest(JSON.stringify({ jobId: request.jobId, rpcId: request.rpcId,
      method: request.method, params: request.params }));
    assert.deepEqual(scope, { version: 1, requestDigest, contextDigest: request.contextDigest,
      command: COMMAND, cwd: CWD, profileId, digest: digest(JSON.stringify({ version: 1,
        requestDigest, contextDigest: request.contextDigest, command: COMMAND, cwd: CWD, profileId })),
      state: 'checking', reason: null });
    assert.deepEqual(createScopedApproval(request), scope);
    assert.deepEqual(request, before);
    assert.doesNotThrow(() => validateScopedApproval(JSON.parse(JSON.stringify(scope))));
    assert.equal(scopedApprovalDigest({ ...scope, jobId: 'unrelated', state: 'sent', choice: choice('sent') }), scope.digest);
  }
});

test('raw digest binds job, RPC id and its type, method, all params and irrelevant classification', () => {
  const original = createScopedApproval(input());
  for (const request of [input({ jobId: 'job-b' }), input({ rpcId: 18 }), input({ rpcId: '17' }),
    input({ method: 'item/fileChange/requestApproval' }), input({}, { itemId: 'item-b' }),
    input({}, { startedAtMs: 1_794_009_600_001 }), input({}, { reason: 'Different explanation' }),
    input({}, { approvalId: 'native-callback-b' }), input({}, { commandActions: [{ type: 'unknown', hint: 'not authority' }] }),
    input({}, { proposedExecpolicyAmendment: ['cat'] }), input({}, { availableDecisions: ['accept', 'decline'] }),
    input({}, { futureField: null }), input({}, { networkApprovalContext: null })]) {
    const scope = createScopedApproval(request);
    assert.notEqual(scope.requestDigest, original.requestDigest);
    assert.notEqual(scope.digest, original.digest);
  }
  assert.equal(createScopedApproval(input({}, { commandActions: [{ type: 'unknown' }] })).state, 'checking');
});

test('all optional null network and additional-permission fields are allowed, every nonnull presence is blocked', () => {
  const fields = ['networkApprovalContext', 'additionalPermissions', 'proposedNetworkPolicyAmendments'];
  assert.equal(createScopedApproval(input({}, Object.fromEntries(fields.map(key => [key, null])))).state, 'checking');
  for (const key of fields) for (const value of [{}, [], false, '', undefined,
    { network: true }, [{ host: 'example.test', action: 'allow' }]]) blocked(input({}, { [key]: value }));
});

test('unknown top-level fields, formal grants and policy extensions fail closed even with plain accept', () => {
  for (const key of ['futureField', 'permissions', 'grant', 'sessionGrant', 'permissionScope', 'sandboxPermissions',
    'approvalPolicy', 'networkPolicy', 'execpolicy_amendment', 'applyNetworkPolicyAmendment', '__proto__', 'constructor']) {
    blocked(input({}, { [key]: null }));
  }
});

test('file changes, stdin and other methods or kinds never become command approval candidates', () => {
  for (const method of ['item/fileChange/requestApproval', 'item/permissions/requestApproval', 'execCommandApproval', '', METHOD + '/future']) {
    blocked(input({ method }));
  }
  for (const kind of ['fileChange', 'stdin', 'network', 'permissions', null, undefined]) blocked(input({}, { kind }));
});

test('thread, turn, item, local environment and the exact binding path must all match', () => {
  for (const params of [{ threadId: 'other' }, { threadId: null }, { turnId: 'other' }, { turnId: '' },
    { itemId: '' }, { itemId: '  ' }, { itemId: null }, { environmentId: null }, { environmentId: 'remote' },
    { environmentId: undefined }, { cwd: CWD + '/' }, { cwd: CWD + '/.' }, { cwd: '/other' }, { cwd: null }]) {
    blocked(input({}, params));
  }
});

test('plain accept must be explicit and all decisions must have known, exact shapes', () => {
  for (const availableDecisions of [['accept'], ['accept', 'decline', 'cancel'], ['accept', rule],
    ['accept', { acceptWithExecpolicyAmendment: { execpolicy_amendment: [] } }]]) {
    assert.equal(createScopedApproval(input({}, { availableDecisions })).state, 'checking');
  }
  for (const availableDecisions of [undefined, null, 'accept', [], ['decline', 'cancel'], [rule],
    ['acceptForSession'], ['accept', 'future'], ['accept', null], ['accept', {}],
    ['accept', { accept: true }], ['accept', { applyNetworkPolicyAmendment: { network_policy_amendment: {} } }],
    ['accept', { acceptWithExecpolicyAmendment: null }], ['accept', { acceptWithExecpolicyAmendment: [] }],
    ['accept', { acceptWithExecpolicyAmendment: { execpolicy_amendment: 'cat' } }],
    ['accept', { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['cat', 1] } }],
    ['accept', { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['cat'], future: true } }],
    ['accept', { ...rule, acceptForSession: true }]]) blocked(input({}, { availableDecisions }));
});

test('offered acceptForSession is metadata, requires plain accept and never becomes a retained choice or grant', () => {
  const scope = createScopedApproval(input({}, { availableDecisions: ['accept', 'acceptForSession', rule, 'decline', 'cancel'] }));
  assert.equal(scope.state, 'checking');
  assert.equal(scope.reason, null);
  assert.ok(!Object.hasOwn(scope, 'choice'));
  assert.ok(!JSON.stringify(scope).includes('acceptForSession'));
  assert.notEqual(scope.requestDigest, createScopedApproval(input()).requestDigest);
  assert.doesNotThrow(() => validateScopedApproval(scope));
  blocked(input({}, { availableDecisions: ['acceptForSession', rule, 'cancel'] }));
  blocked(input({}, { availableDecisions: ['accept', 'acceptForSession'], additionalPermissions: { scope: 'session' } }));
  blocked(input({}, { availableDecisions: ['accept', 'acceptForSession', 'unknownDecision'] }));
});

test('command redaction, truncation and mismatches block without retaining the raw hidden command or reason', () => {
  const hidden = 'printf hidden-secret-0123456789';
  const scope = blocked(input({ displayCommand: 'printf [REDACTED]' }, { command: hidden, reason: hidden,
    commandActions: [{ type: 'read', command: hidden }], proposedExecpolicyAmendment: [hidden] }));
  assert.ok(!JSON.stringify(scope).includes(hidden));
  assert.ok(!Object.hasOwn(scope, 'params'));
  const otherHidden = blocked(input({ displayCommand: scope.command }, { command: hidden + '-changed' }));
  assert.notEqual(otherHidden.requestDigest, scope.requestDigest);
  assert.notEqual(otherHidden.digest, scope.digest);
  blocked(input({ displayCommand: COMMAND.slice(0, -1) }));
  blocked(input({ displayCommand: COMMAND + ' ' }));
});

test('commands are bounded, nonblank and free of NUL and terminal controls; multiline text stays exact', () => {
  for (const value of ['', ' \n\t', 'x'.repeat(30_001), 'x\0y', 'x\x1by', 'x\x07y', 'x\by', 'x\ry', 'x\x7fy', 'x\x9by']) {
    blocked(input({ displayCommand: value }, { command: value }));
  }
  for (const value of [null, undefined, 42, ['cat']]) blocked(input({}, { command: value }));
  for (const value of ['x'.repeat(30_000), 'printf "한글"\ncat\tvalidation.txt']) {
    assert.equal(createScopedApproval(input({ displayCommand: value }, { command: value })).state, 'checking');
  }
});

test('malformed optional native metadata blocks without treating classification as authority', () => {
  for (const params of [{ startedAtMs: -1 }, { startedAtMs: 1.5 }, { startedAtMs: 'today' }, { startedAtMs: null },
    { approvalId: '' }, { approvalId: 42 }, { reason: {} }, { commandActions: {} },
    { proposedExecpolicyAmendment: 'cat' }, { proposedExecpolicyAmendment: [1] }]) blocked(input({}, params));
  const minimal = input();
  for (const key of ['startedAtMs', 'approvalId', 'reason', 'commandActions', 'proposedExecpolicyAmendment']) delete minimal.params[key];
  assert.equal(createScopedApproval(minimal).state, 'checking');
  assert.equal(createScopedApproval(input({}, { commandActions: null, proposedExecpolicyAmendment: null })).state, 'checking');
});

test('validator enforces every state and choice-delivery combination, including restart before owner selection', () => {
  const scope = createScopedApproval(input());
  const allowed = { checking: [null], ready: [null], selected: ['prepared'], sent: ['sent'],
    unconfirmed: [null, 'sending', 'unconfirmed'], blocked: [null, 'prepared', 'cancelled', 'unconfirmed'] };
  for (const [state, valid] of Object.entries(allowed)) {
    for (const delivery of [null, 'prepared', 'sending', 'sent', 'unconfirmed', 'cancelled']) {
      const value = { ...scope, state, reason: state === 'blocked' ? 'scoped_approval_scope_changed' : null,
        ...(delivery === null ? {} : { choice: choice(delivery) }) };
      if (valid.includes(delivery)) assert.doesNotThrow(() => validateScopedApproval(value), `${state}/${delivery}`);
      else invalid(value);
    }
  }
});

test('blocked commands keep their exact display and valid seal when restart requires reconciliation', () => {
  for (const displayCommand of ['', 'x\0y', 'x'.repeat(30_001)]) {
    const scope = blocked(input({ displayCommand }, { command: displayCommand }));
    const recovered = { ...scope, state: 'unconfirmed', reason: 'scoped_approval_reconciliation_required' };
    assert.doesNotThrow(() => validateScopedApproval(recovered));
    assert.equal(recovered.digest, scope.digest);
    for (const state of ['checking', 'ready', 'selected', 'sent']) {
      invalid({ ...recovered, state, ...(['selected', 'sent'].includes(state) ? { choice: choice(state === 'selected' ? 'prepared' : 'sent') } : {}) });
    }
  }
});

test('validator recomputes the seal and rejects independent mutations to all visible bound fields', () => {
  const scope = createScopedApproval(input());
  for (const patch of [{ command: COMMAND + ' changed' }, { cwd: '/other' }, { profileId: 'webjjoku_copy' },
    { requestDigest: digest('other request') }, { contextDigest: digest('other context') }]) {
    const changed = { ...scope, ...patch };
    invalid(changed);
    assert.notEqual(scopedApprovalDigest(changed), scope.digest);
    assert.doesNotThrow(() => validateScopedApproval(seal(changed)));
  }
});

test('validator rejects future, missing, null, malformed and unknown scope metadata with the exact AppError', () => {
  const scope = createScopedApproval(input());
  for (const value of [null, undefined, false, 1, 'scope', [], new Date(), {}]) invalid(value);
  for (const patch of [{ version: 2 }, { version: '1' }, { version: null }, { state: 'future' }, { state: null },
    { digest: null }, { digest: scope.digest.toUpperCase() }, { digest: 'a'.repeat(63) },
    { digest: 'x'.repeat(64) }, { digest: digest('wrong seal') }, { requestDigest: null }, { contextDigest: 'invalid' },
    { profileId: 'future' }, { profileId: null }, { command: null }, { command: '' }, { command: 'x\0y' },
    { command: 'x'.repeat(30_001) }, { cwd: null }, { cwd: 'relative' }, { cwd: '/tmp/\0invalid' },
    { reason: false }, { reason: '' }, { state: 'blocked', reason: null }, { futureMetadata: null },
    { choice: null }, { choice: undefined }]) invalid({ ...scope, ...patch });
  for (const key of Object.keys(scope)) {
    const value = { ...scope }; delete value[key]; invalid(value);
  }
  for (const patch of [{ version: 2 }, { profileId: 'future' }, { command: '' }, { cwd: 'relative' },
    { requestDigest: 'invalid' }, { contextDigest: 'A'.repeat(64) }]) invalid(seal({ ...scope, ...patch }));
});

test('validator rejects unknown or malformed choice data and invalid or normalized calendar dates', () => {
  const selected = { ...createScopedApproval(input()), state: 'selected', choice: choice('prepared') };
  for (const value of [null, undefined, false, [], {}, { ...choice('prepared'), future: 1 },
    { ...choice('prepared'), version: 2 }, { ...choice('prepared'), commandId: '' },
    { ...choice('prepared'), commandId: null }, { ...choice('prepared'), delivery: 'future' }]) invalid({ ...selected, choice: value });
  for (const selectedAt of [undefined, null, 42, '', 'yesterday', '2026-02-30T00:00:00.000Z',
    '2026-11-07', '2026-11-07T25:00:00.000Z', '2026-11-07T12:00:00Z', '2026-11-07T12:00:00.000Z trailing']) {
    invalid({ ...selected, choice: { ...selected.choice, selectedAt } });
  }
  for (const key of Object.keys(selected.choice)) {
    const value = { ...selected.choice }; delete value[key]; invalid({ ...selected, choice: value });
  }
});
