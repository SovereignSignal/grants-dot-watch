import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { createCuratorGate } from '../src/lib/curator-auth.ts';
import {
  decideCuratorItem,
  defaultCuratorDeps,
  forbidCurator,
  getCuratorItem,
  listCuratorQueue,
  proposeCuratorItem,
  reviewCuratorItem,
  searchCuratorDirectory,
} from '../src/lib/curator-api.ts';
import { fileIdempotencyStore, interpretIdempotency, memoryIdempotencyStore } from '../src/lib/curator-idempotency.ts';
import { decideProposal } from '../src/lib/desk-decide.ts';
import { buildDeskLog } from '../src/lib/desk-log.ts';
import { laneFor } from '../src/proposal-lanes.ts';

const exec = promisify(execFile);
const TOKEN = 'unit-test-only-token-000000000000000000';
const READ_TOKEN = 'unit-test-only-reader-00000000000000000';
const hash = createHash('sha256').update(TOKEN).digest('hex');
const readHash = createHash('sha256').update(READ_TOKEN).digest('hex');

function key(overrides = {}) {
  return {
    id: 'hedwig',
    name: 'Hedwig',
    sha256: hash,
    scopes: ['read_queue', 'decide', 'propose'],
    expires_at: '2099-01-01T00:00:00.000Z',
    revoked: false,
    ...overrides,
  };
}

function gateFor(records, now = () => Date.parse('2026-06-01T00:00:00.000Z')) {
  return createCuratorGate(() => JSON.stringify(records), now);
}

function request(url, { token = TOKEN, method = 'GET', body, idempotency } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (idempotency) headers['idempotency-key'] = idempotency;
  return new Request(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

const pending = {
  id: 'p00001',
  type: 'deadline_change',
  org: 'example',
  org_name: 'Example',
  program: 'Example Grants',
  title: 'Example deadline',
  summary: 'The example program closes later in the year.',
  evidence_url: 'https://example.org/grants',
  proposed_change: { 'programs/example-grants.yaml': { rounds: [{ name: '2026', closes: '2026-12-01' }] } },
  confidence: 90,
  wire: 'ai',
  lane: 'fact',
  state: 'pending',
  created_at: '2026-06-01T00:00:00.000Z',
};

const older = {
  ...pending,
  id: 'p00000',
  title: 'Older judgment',
  summary: 'A profile note from the wire.',
  type: 'profile_note',
  lane: 'judgment',
  wire: 'oss',
  confidence: 40,
  created_at: '2026-05-01T00:00:00.000Z',
};

const mergeItem = {
  ...pending,
  id: 'p00002',
  type: 'merge_orgs',
  lane: 'judgment',
  title: 'Merge example orgs',
  proposed_change: { a: 'example', b: 'example-2' },
};

const deletion = {
  ...pending,
  id: 'p00003',
  type: 'profile_note',
  lane: 'judgment',
  title: 'Delete the program',
  proposed_change: { remove: 'programs/example-grants.yaml' },
};

const registry = {
  orgs: [{
    id: 'example',
    name: 'Example',
    aka: ['Example Funder'],
    systems: [],
    wires: ['ai'],
    roles: ['funder'],
    status: 'active',
    profile: 'An example funder that ships grants.',
    sources: ['https://example.org'],
  }],
  programs: [{
    id: 'example-grants',
    name: 'Example Grants',
    org: 'example',
    systems: [],
    wires: ['ai'],
    status: 'active',
    summary: 'Rolling grants for builders in the example ecosystem.',
    rounds: [],
    sources: ['https://example.org/grants'],
  }],
};

function deps(extra = {}) {
  const proposals = new Map([
    ['p00001', structuredClone(pending)],
    ['p00000', structuredClone(older)],
    ['p00002', structuredClone(mergeItem)],
    ['p00003', structuredClone(deletion)],
  ]);
  const inserted = [];
  const decisions = [];
  return {
    inserted,
    decisions,
    api: {
      gate: gateFor([key()]),
      now: () => Date.parse('2026-06-01T00:00:00.000Z'),
      idempotency: memoryIdempotencyStore(() => Date.parse('2026-06-01T00:00:00.000Z')),
      listProposals: async () => [...proposals.values()],
      getProposal: async (id) => proposals.get(id) || null,
      insertProposals: async (candidates) => {
        inserted.push(candidates[0]);
        const item = candidates[0];
        return {
          inserted: [{
            id: 'p00099',
            type: item.type,
            lane: laneFor(item.type, item.evidence_url),
            state: 'pending',
            submitted_by: item.submitted_by,
          }],
          skipped: 0,
        };
      },
      decide: async (input) => {
        decisions.push(input);
        return {
          status: 200,
          body: {
            ok: true,
            commit: null,
            proposal: { ...pending, id: input.id, state: input.decision },
            verdict: {
              proposal_id: input.id,
              decision: input.decision,
              at: '2026-06-01T00:01:00.000Z',
              note: input.note,
              by: input.by,
              curator_id: input.curator_id,
              curator_name: input.curator_name,
              sources: input.sources,
              commit: null,
            },
          },
        };
      },
      saveReview: async (id, review) => {
        const proposal = proposals.get(id);
        if (!proposal) return { status: 'missing' };
        if (proposal.state !== 'pending') return { status: 'decided' };
        const next = {
          ...proposal,
          curator_review: review,
          curator_review_history: [...(proposal.curator_review_history || []), review],
        };
        proposals.set(id, next);
        return { status: 'saved', proposal: next };
      },
      loadRegistry: () => registry,
      preview: () => ({ changes: [{ path: 'registry/programs/example-grants.yaml', content: 'name: Example', op: 'update' }], notes: ['preview'] }),
      evidence: () => null,
      ...extra,
    },
  };
}

const source = { url: 'https://example.org/grants', quote: 'Applications close on 1 December 2026.' };

test('curator keys fail closed for missing, invalid, expired, and revoked tokens', async () => {
  const base = deps();
  const missing = await listCuratorQueue(request('https://grants.watch/api/v1/curator/queue', { token: '' }), base.api);
  assert.equal(missing.status, 401);
  assert.deepEqual(await missing.json(), { error: 'unauthorized' });

  const wrong = deps();
  const invalid = await listCuratorQueue(request('https://grants.watch/api/v1/curator/queue', { token: 'not-a-curator-token-0000000000000000' }), wrong.api);
  assert.equal(invalid.status, 401);
  assert.equal(invalid.headers.get('cache-control'), 'private, no-store');

  const admin = deps();
  const adminOnly = new Request('https://grants.watch/api/v1/curator/queue', { headers: { 'x-admin-token': TOKEN, cookie: `gw_admin=${TOKEN}` } });
  assert.equal((await listCuratorQueue(adminOnly, admin.api)).status, 401);

  let now = Date.parse('2099-01-01T00:00:00.000Z');
  const expired = deps({ gate: gateFor([key()], () => now) });
  const expiredResponse = await listCuratorQueue(request('https://grants.watch/api/v1/curator/queue'), expired.api);
  assert.equal(expiredResponse.status, 403);
  assert.deepEqual(await expiredResponse.json(), { error: 'expired' });

  const revoked = deps({ gate: gateFor([key({ revoked: true })]) });
  const revokedResponse = await listCuratorQueue(request('https://grants.watch/api/v1/curator/queue'), revoked.api);
  assert.equal(revokedResponse.status, 403);
  assert.deepEqual(await revokedResponse.json(), { error: 'revoked' });

  const revokedAt = deps({ gate: gateFor([key({ revoked_at: '2026-01-01T00:00:00.000Z' })]) });
  const revokedAtResponse = await listCuratorQueue(request('https://grants.watch/api/v1/curator/queue'), revokedAt.api);
  assert.equal(revokedAtResponse.status, 403);
  assert.deepEqual(await revokedAtResponse.json(), { error: 'revoked' });

  const notYet = deps({ gate: gateFor([key({ revoked_at: '2099-01-01T00:00:00.000Z' })]) });
  assert.equal((await listCuratorQueue(request('https://grants.watch/api/v1/curator/queue'), notYet.api)).status, 200);

  const readerKey = deps({ gate: gateFor([key({ sha256: readHash })]) });
  assert.equal((await listCuratorQueue(request('https://grants.watch/api/v1/curator/queue'), readerKey.api)).status, 401);

  const broken = deps({ gate: createCuratorGate(() => '{', () => Date.parse('2026-06-01T00:00:00.000Z')) });
  assert.equal((await listCuratorQueue(request('https://grants.watch/api/v1/curator/queue'), broken.api)).status, 503);
  const empty = deps({ gate: createCuratorGate(() => '[]', () => Date.parse('2026-06-01T00:00:00.000Z')) });
  assert.equal((await listCuratorQueue(request('https://grants.watch/api/v1/curator/queue'), empty.api)).status, 503);
});

test('a revoked_at that passes between 8:00 and 9:45am PT is not a bare 401', async () => {
  // 2026-10-04 15:00Z is 8:00am PT; 16:00Z is 9:00am PT; 16:45Z is 9:45am PT.
  const record = key({
    revoked: false,
    revoked_at: '2026-10-04T16:00:00.000Z',
    expires_at: '2027-01-01T00:00:00.000Z',
  });
  const atEight = deps({ gate: gateFor([record], () => Date.parse('2026-10-04T15:00:00.000Z')) });
  assert.equal((await listCuratorQueue(request('https://grants.watch/api/v1/curator/queue'), atEight.api)).status, 200);

  const lines = [];
  const original = console.error;
  console.error = (...args) => {
    lines.push(args.map(String).join(' '));
  };
  try {
    const atNineFortyFive = deps({ gate: gateFor([record], () => Date.parse('2026-10-04T16:45:00.000Z')) });
    const denied = await listCuratorQueue(request('https://grants.watch/api/v1/curator/queue'), atNineFortyFive.api);
    assert.equal(denied.status, 403);
    assert.deepEqual(await denied.json(), { error: 'revoked' });
    const logged = lines.join('\n');
    assert.match(logged, /reason=revoked/);
    assert.match(logged, /key_id=hedwig/);
    assert.equal(logged.includes(TOKEN), false);
    assert.equal(logged.includes(hash), false);
  } finally {
    console.error = original;
  }
});

test('a 2027 key still authenticates on the morning it was reported dead', async () => {
  const record = key({ revoked: false, expires_at: '2027-01-01T00:00:00.000Z' });
  const gate = gateFor([record], () => Date.parse('2026-10-04T16:45:00.000Z'));
  assert.equal((await listCuratorQueue(request('https://grants.watch/api/v1/curator/queue'), deps({ gate }).api)).status, 200);
  const lower = new Request('https://grants.watch/api/v1/curator/queue', { headers: { authorization: `bearer ${TOKEN}` } });
  const spaced = new Request('https://grants.watch/api/v1/curator/queue', { headers: { authorization: `Bearer  ${TOKEN}` } });
  assert.equal((await listCuratorQueue(lower, deps({ gate }).api)).status, 200);
  assert.equal((await listCuratorQueue(spaced, deps({ gate }).api)).status, 200);
});

test('an unset curator key config is inert and does not consult other service keys', async () => {
  let listed = 0;
  let inserted = 0;
  let decided = 0;
  let claimed = 0;
  const gate = createCuratorGate(() => process.env.GRANTS_WATCH_CURATOR_KEYS);
  const { api } = deps({
    gate,
    idempotency: { claim: async () => { claimed += 1; return 'pending'; }, release: async () => {}, finish: async () => {} },
    listProposals: async () => { listed += 1; return []; },
    getProposal: async () => { listed += 1; return null; },
    insertProposals: async () => { inserted += 1; return { inserted: [], skipped: 0 }; },
    decide: async () => { decided += 1; return { status: 500, body: {} }; },
  });
  const previous = {
    curator: process.env.GRANTS_WATCH_CURATOR_KEYS,
    internal: process.env.INTERNAL_API_KEY,
    admin: process.env.ADMIN_TOKEN,
    reader: process.env.GRANTS_WATCH_READER_KEYS,
  };
  delete process.env.GRANTS_WATCH_CURATOR_KEYS;
  process.env.INTERNAL_API_KEY = 'wire-room-ops-internal';
  process.env.ADMIN_TOKEN = 'desk-admin-token';
  process.env.GRANTS_WATCH_READER_KEYS = JSON.stringify([{ id: 'reader', sha256: readHash, expires_at: '2099-01-01T00:00:00.000Z' }]);
  try {
    const queue = await listCuratorQueue(request('https://grants.watch/api/v1/curator/queue'), api);
    assert.equal(queue.status, 503);
    assert.deepEqual(await queue.json(), { error: 'curator_unavailable' });
    const item = await getCuratorItem(request('https://grants.watch/api/v1/curator/queue/p00001'), 'p00001', api);
    assert.equal(item.status, 503);
    const decidedResponse = await decideCuratorItem(
      request('https://grants.watch/api/v1/curator/queue/p00001/decide', {
        method: 'POST',
        body: { decision: 'approved', reason: 'Official page confirms the date.' },
        idempotency: 'inert-decide-1',
      }),
      'p00001',
      api
    );
    assert.equal(decidedResponse.status, 503);
    const proposed = await proposeCuratorItem(
      request('https://grants.watch/api/v1/curator/proposals', {
        method: 'POST',
        body: { kind: 'new_org', name: 'Example', reason: 'Official page confirms the org.', sources: [source] },
        idempotency: 'inert-propose-1',
      }),
      api
    );
    assert.equal(proposed.status, 503);
    assert.equal(listed, 0);
    assert.equal(inserted, 0);
    assert.equal(decided, 0);
    assert.equal(claimed, 0);
  } finally {
    for (const [name, value] of Object.entries({
      GRANTS_WATCH_CURATOR_KEYS: previous.curator,
      INTERNAL_API_KEY: previous.internal,
      ADMIN_TOKEN: previous.admin,
      GRANTS_WATCH_READER_KEYS: previous.reader,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
  const authSource = readFileSync(new URL('../src/lib/curator-auth.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(authSource, /process\.env\.(INTERNAL_API_KEY|ADMIN_TOKEN|GRANTS_WATCH_READER_KEYS|WIRE_DATABASE_URL)/);
});

test('wrong scope is forbidden without saying which scope or key failed', async () => {
  const readOnly = deps({ gate: gateFor([key({ scopes: ['read_queue'] })]) });
  const denied = await decideCuratorItem(
    request('https://grants.watch/api/v1/curator/queue/p00001/decide', {
      method: 'POST',
      body: { decision: 'approved', reason: 'Official page confirms the date.' },
      idempotency: 'decide-scope-1',
    }),
    'p00001',
    readOnly.api
  );
  assert.equal(denied.status, 403);
  assert.deepEqual(await denied.json(), { error: 'forbidden' });
  assert.equal(readOnly.decisions.length, 0);

  const proposeOnly = deps({ gate: gateFor([key({ scopes: ['propose'] })]) });
  assert.equal((await listCuratorQueue(request('https://grants.watch/api/v1/curator/queue'), proposeOnly.api)).status, 403);
});

test('queue list filters by type, wire, score, and text, and paginates', async () => {
  const { api } = deps();
  const all = await (await listCuratorQueue(request('https://grants.watch/api/v1/curator/queue'), api)).json();
  assert.deepEqual(all.data.map((item) => item.id), ['p00000', 'p00001', 'p00002', 'p00003']);
  assert.equal(all.meta.pending_judgment, 3);
  assert.equal(all.meta.pending_fact, 1);

  const filtered = await (await listCuratorQueue(request('https://grants.watch/api/v1/curator/queue?lane=fact&wire=ai&score=high&q=deadline'), api)).json();
  assert.deepEqual(filtered.data.map((item) => item.id), ['p00001']);

  const page = await (await listCuratorQueue(request('https://grants.watch/api/v1/curator/queue?limit=1&page=2'), api)).json();
  assert.equal(page.data[0].id, 'p00001');
  assert.equal(page.meta.next_page, 3);
  assert.equal((await listCuratorQueue(request('https://grants.watch/api/v1/curator/queue?bulk=1'), api)).status, 400);
});

test('one queue item includes the proposed change and sources', async () => {
  const { api } = deps();
  const response = await getCuratorItem(request('https://grants.watch/api/v1/curator/queue/p00001'), 'p00001', api);
  const body = await response.json();
  assert.equal(body.data.proposed_change['programs/example-grants.yaml'].rounds[0].closes, '2026-12-01');
  assert.deepEqual(body.data.sources, ['https://example.org/grants']);
  assert.deepEqual(body.data.destination, ['registry/programs/example-grants.yaml']);
  assert.equal((await getCuratorItem(request('https://grants.watch/api/v1/curator/queue/missing'), 'missing', api)).status, 404);
});

test('approve and reject go through decideProposal and require a reason', async () => {
  const { api, decisions } = deps();
  const approved = await decideCuratorItem(
    request('https://grants.watch/api/v1/curator/queue/p00001/decide', {
      method: 'POST',
      idempotency: 'approve-1',
      body: { decision: 'approved', reason: 'Official page confirms the date.', sources: ['https://example.org/grants'] },
    }),
    'p00001',
    api
  );
  assert.equal(approved.status, 200);
  assert.equal(decisions[0].by, 'curator');
  assert.equal(decisions[0].curator_name, 'Hedwig');
  assert.equal(decisions[0].note, 'Official page confirms the date.');
  assert.deepEqual(decisions[0].sources, ['https://example.org/grants']);

  const rejected = await decideCuratorItem(
    request('https://grants.watch/api/v1/curator/queue/p00001/decide', {
      method: 'POST',
      idempotency: 'reject-1',
      body: { decision: 'rejected', reason: 'The page does not say this.' },
    }),
    'p00001',
    api
  );
  assert.equal(rejected.status, 200);
  assert.equal(decisions[1].decision, 'rejected');

  const missing = await decideCuratorItem(
    request('https://grants.watch/api/v1/curator/queue/p00001/decide', {
      method: 'POST',
      idempotency: 'reject-2',
      body: { decision: 'rejected' },
    }),
    'p00001',
    api
  );
  assert.equal(missing.status, 400);
  assert.equal(decisions.length, 2);
});

test('merges, deletions, bulk decides, and config changes are forbidden', async () => {
  const merged = deps();
  const mergeDecision = await decideCuratorItem(
    request('https://grants.watch/api/v1/curator/queue/p00002/decide', {
      method: 'POST',
      idempotency: 'merge-1',
      body: { decision: 'approved', reason: 'They look the same in the source.' },
    }),
    'p00002',
    merged.api
  );
  assert.equal(mergeDecision.status, 403);
  assert.equal(merged.decisions.length, 0);

  const removed = deps();
  assert.equal((await decideCuratorItem(
    request('https://grants.watch/api/v1/curator/queue/p00003/decide', {
      method: 'POST',
      idempotency: 'delete-1',
      body: { decision: 'approved', reason: 'This record should not stay on file.' },
    }),
    'p00003',
    removed.api
  )).status, 403);

  const bulk = deps();
  assert.equal((await decideCuratorItem(
    request('https://grants.watch/api/v1/curator/queue/p00001/decide', {
      method: 'POST',
      body: { ids: ['p00001'], decision: 'approved', reason: 'Apply the whole set together.' },
    }),
    'p00001',
    bulk.api
  )).status, 403);

  const config = deps();
  assert.equal((await proposeCuratorItem(
    request('https://grants.watch/api/v1/curator/proposals', {
      method: 'POST',
      body: { kind: 'delete', admin_token: 'nope' },
    }),
    config.api
  )).status, 403);
  assert.equal((await proposeCuratorItem(
    request('https://grants.watch/api/v1/curator/proposals', {
      method: 'POST',
      idempotency: 'merge-kind-1',
      body: { kind: 'merge_orgs', reason: 'Combine these two organizations.', summary: 'Same organization under two names.', sources: [source] },
    }),
    config.api
  )).status, 403);

  assert.equal((await forbidCurator(request('https://grants.watch/api/v1/curator/bulk', { method: 'POST', body: {} }), bulk.api)).status, 403);
  assert.equal((await forbidCurator(request('https://grants.watch/api/v1/curator/merge', { method: 'POST', token: '' }), bulk.api)).status, 401);
  for (const file of [
    'src/app/api/v1/curator/bulk/route.ts',
    'src/app/api/v1/curator/merge/route.ts',
    'src/app/api/v1/curator/config/route.ts',
    'src/app/api/v1/curator/queue/[id]/route.ts',
  ]) {
    assert.match(readFileSync(file, 'utf8'), /forbidCurator/);
  }
});

test('proposals land in the desk queue attributed to the curator key', async () => {
  const created = deps();
  const response = await proposeCuratorItem(
    request('https://grants.watch/api/v1/curator/proposals', {
      method: 'POST',
      idempotency: 'org-fresh-1',
      body: {
        kind: 'new_org',
        name: 'Fresh Foundation',
        wire: 'oss',
        website: 'https://fresh.example.org',
        summary: 'Fresh Foundation publishes an open-source grants program.',
        reason: 'No organization file matches this name or site.',
        sources: [source],
      },
    }),
    created.api
  );
  assert.equal(response.status, 201);
  assert.equal(created.inserted[0].submitted_by.key_id, 'hedwig');
  assert.equal(created.inserted[0].submitted_by.key_name, 'Hedwig');
  assert.equal(created.inserted[0].submitted_by.quotes[0].quote, source.quote);
  assert.equal(created.inserted[0].type, 'new_org');

  const duplicate = deps();
  const conflict = await proposeCuratorItem(
    request('https://grants.watch/api/v1/curator/proposals', {
      method: 'POST',
      idempotency: 'org-example-1',
      body: {
        kind: 'new_org',
        name: 'Example',
        summary: 'Example is already on the registry under this name.',
        reason: 'Checking that duplicates are refused before insert.',
        sources: [source],
      },
    }),
    duplicate.api
  );
  assert.equal(conflict.status, 409);
  assert.equal(duplicate.inserted.length, 0);

  const deadline = deps();
  const fact = await proposeCuratorItem(
    request('https://grants.watch/api/v1/curator/proposals', {
      method: 'POST',
      idempotency: 'deadline-1',
      body: {
        kind: 'fact',
        fact: 'deadline',
        program_id: 'example-grants',
        round: '2026',
        closes: '2026-12-01',
        summary: 'The program page moved the 2026 close to 1 December.',
        reason: 'Primary page states the new deadline.',
        sources: [source],
      },
    }),
    deadline.api
  );
  assert.equal(fact.status, 201);
  assert.equal((await fact.json()).lane, 'fact');
  assert.equal(deadline.inserted[0].type, 'deadline_change');

  const handle = deps();
  const x = await proposeCuratorItem(
    request('https://grants.watch/api/v1/curator/proposals', {
      method: 'POST',
      idempotency: 'handle-1',
      body: {
        kind: 'fact',
        fact: 'x_handle',
        org_id: 'example',
        x: '@example',
        summary: 'The organization site links this X account.',
        reason: 'The official site shows the handle in the footer.',
        sources: [source],
      },
    }),
    handle.api
  );
  assert.equal(x.status, 201);
  assert.equal((await x.json()).lane, 'judgment');
  assert.equal(handle.inserted[0].proposed_change['orgs/example.yaml'].socials.x, 'https://x.com/example');

  const bare = deps();
  assert.equal((await proposeCuratorItem(
    request('https://grants.watch/api/v1/curator/proposals', {
      method: 'POST',
      idempotency: 'no-quote-1',
      body: { kind: 'new_program', org_id: 'example', program_name: 'Other Grants', summary: 'A second program from the same organization.', reason: 'The page describes another program.', sources: [{ url: 'https://example.org/other', quote: 'too short' }] },
    }),
    bare.api
  )).status, 400);
});

test('search returns existing orgs and programs and does not write', async () => {
  const { api, inserted, decisions } = deps();
  const body = await (await searchCuratorDirectory(request('https://grants.watch/api/v1/curator/search?q=example&kind=programs'), api)).json();
  assert.equal(body.data[0].id, 'example-grants');
  assert.equal(body.data[0].kind, 'program');
  const both = await (await searchCuratorDirectory(request('https://grants.watch/api/v1/curator/search?q=example'), api)).json();
  assert.equal(both.meta.total, 2);
  assert.equal(inserted.length, 0);
  assert.equal(decisions.length, 0);
});

test('writes replay an idempotency key and refuse a reused key with a different body', async () => {
  const { api, decisions } = deps();
  const first = await decideCuratorItem(
    request('https://grants.watch/api/v1/curator/queue/p00001/decide', {
      method: 'POST',
      idempotency: 'same-key-1',
      body: { decision: 'approved', reason: 'Official page confirms the date.' },
    }),
    'p00001',
    api
  );
  const replay = await decideCuratorItem(
    request('https://grants.watch/api/v1/curator/queue/p00001/decide', {
      method: 'POST',
      idempotency: 'same-key-1',
      body: { decision: 'approved', reason: 'Official page confirms the date.' },
    }),
    'p00001',
    api
  );
  assert.equal(replay.status, 200);
  assert.equal(replay.headers.get('idempotent-replayed'), 'true');
  assert.deepEqual(await replay.json(), await first.json());
  assert.equal(decisions.length, 1);

  const conflict = await decideCuratorItem(
    request('https://grants.watch/api/v1/curator/queue/p00001/decide', {
      method: 'POST',
      idempotency: 'same-key-1',
      body: { decision: 'rejected', reason: 'A different decision under the same key.' },
    }),
    'p00001',
    api
  );
  assert.equal(conflict.status, 409);
  assert.equal(decisions.length, 1);
});

test('writes are limited to 30 per minute per key', async () => {
  const { api } = deps();
  for (let n = 0; n < 30; n += 1) {
    const response = await decideCuratorItem(
      request('https://grants.watch/api/v1/curator/queue/p00001/decide', {
        method: 'POST',
        idempotency: `rate-key-${n}`,
        body: { decision: 'rejected', reason: 'Holding this item for a later pass.' },
      }),
      'p00001',
      api
    );
    assert.equal(response.status, 200, `write ${n}`);
  }
  const blocked = await decideCuratorItem(
    request('https://grants.watch/api/v1/curator/queue/p00001/decide', {
      method: 'POST',
      idempotency: 'rate-key-30',
      body: { decision: 'rejected', reason: 'This one should be rate limited.' },
    }),
    'p00001',
    api
  );
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('retry-after'), '60');
});

test('decideProposal is the desk approve path and stamps the curator on the verdict', async () => {
  assert.equal(defaultCuratorDeps.decide, decideProposal);
  const proposal = { ...pending };
  let message = '';
  const result = await decideProposal({
    id: 'p00001',
    decision: 'approved',
    note: 'Official page confirms the date.',
    by: 'curator',
    curator_id: 'hedwig',
    curator_name: 'Hedwig',
    sources: ['https://example.org/grants'],
  }, {
    getProposal: async () => proposal,
    claimProposal: async () => ({ ...proposal, state: 'applying' }),
    releaseProposalClaim: async () => true,
    applyProposalDurably: async (_proposal, commitMessage) => {
      message = commitMessage;
      return { changes: [{ path: 'registry/programs/example-grants.yaml' }], notes: [], commit: 'abc1234' };
    },
    recordVerdict: async (id, decision, opts) => ({
      proposal: { ...proposal, state: decision, decision_note: opts.note },
      verdict: {
        proposal_id: id,
        decision,
        at: '2026-06-01T00:01:00.000Z',
        note: opts.note,
        commit: opts.commit,
        by: opts.by,
        curator_id: opts.curator_id,
        curator_name: opts.curator_name,
        sources: opts.sources,
      },
    }),
    registryMayHaveChanged: () => false,
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.verdict.by, 'curator');
  assert.equal(result.body.verdict.curator_name, 'Hedwig');
  assert.match(message, /Curator: Hedwig \(hedwig\)/);
  assert.match(message, /Reason: Official page confirms the date\./);
});

test('the desk log labels curator decisions and queued proposals', () => {
  const rows = buildDeskLog(
    [{ ...pending, destination: ['registry/programs/example-grants.yaml'], submitted_by: { key_id: 'hedwig', key_name: 'Hedwig', reason: 'Primary page states the new deadline.', sources: [source.url], quotes: [source], at: '2026-06-01T00:00:00.000Z' } }],
    [{ proposal_id: 'p00001', decision: 'approved', at: '2026-06-01T00:05:00.000Z', note: 'Official page confirms the date.', by: 'curator', curator_id: 'hedwig', curator_name: 'Hedwig', commit: null }]
  );
  assert.equal(rows[0].action, 'approved');
  assert.equal(rows[0].actor, 'curator · Hedwig');
  assert.equal(rows[1].action, 'queued');
  assert.equal(rows[1].actor, 'curator · Hedwig');
  assert.equal(rows[1].note, 'Primary page states the new deadline.');
});

test('idempotency records expire and a file store lets only one claim win', async () => {
  assert.equal(
    interpretIdempotency({ state: 'pending', at: '2026-06-01T00:00:00.000Z', body_hash: 'abc' }, 'abc', Date.parse('2026-06-01T00:16:00.000Z')),
    'expired'
  );
  assert.equal(
    interpretIdempotency({ state: 'done', at: '2026-06-01T00:00:00.000Z', body_hash: 'abc', status: 201, body: { ok: true } }, 'nope', Date.parse('2026-06-01T01:00:00.000Z')),
    'mismatch'
  );
  const dir = await mkdtemp(join(tmpdir(), 'curator-idem-'));
  const now = Date.parse('2026-06-01T00:00:00.000Z');
  const store = fileIdempotencyStore(join(dir, 'idem.json'), () => now);
  const claims = await Promise.all([
    store.claim('key', 'hash', '2026-06-01T00:00:00.000Z'),
    store.claim('key', 'hash', '2026-06-01T00:00:00.000Z'),
  ]);
  assert.deepEqual(claims.sort(), ['claimed', 'pending']);
  await store.finish('key', 201, { ok: true, id: 'p00099' }, 'hash', '2026-06-01T00:00:01.000Z');
  const replay = await store.claim('key', 'hash', '2026-06-01T00:00:02.000Z');
  assert.deepEqual(replay, { replay: { status: 201, body: { ok: true, id: 'p00099' } } });
});

const reviewBody = {
  verdict: 'reject',
  reason: 'The page describes a research office, not an open grant.',
  sources: [{ url: 'https://example.org/grants', quote: 'Applications close on 1 December 2026.' }],
  facts: { status: 'paused', deadline: '2026-11-15', amount: '$10M', org_name: 'Example Foundation', program_name: 'Example Open' },
};

test('a curator review annotates a proposal and does not change its state', async () => {
  const { api, decisions } = deps();
  const proposeOnly = deps({ gate: gateFor([key({ scopes: ['propose'] })]) });
  const reader = deps({ gate: gateFor([key({ scopes: ['read_queue'] })]) });
  const decider = deps({ gate: gateFor([key({ scopes: ['decide'] })]) });

  assert.equal((await reviewCuratorItem(
    request('https://grants.watch/api/v1/curator/queue/p00001/review', { body: reviewBody, idempotency: 'review-reader-1', method: 'POST' }),
    'p00001',
    reader.api
  )).status, 403);
  assert.equal((await reviewCuratorItem(
    request('https://grants.watch/api/v1/curator/queue/p00001/review', { body: reviewBody, idempotency: 'review-decide-1', method: 'POST' }),
    'p00001',
    decider.api
  )).status, 403);

  const missingKey = await reviewCuratorItem(
    request('https://grants.watch/api/v1/curator/queue/p00001/review', { body: reviewBody, method: 'POST' }),
    'p00001',
    proposeOnly.api
  );
  assert.equal(missingKey.status, 400);

  const scoped = await reviewCuratorItem(
    request('https://grants.watch/api/v1/curator/queue/p00001/review', { body: reviewBody, idempotency: 'review-propose-only-1', method: 'POST' }),
    'p00001',
    proposeOnly.api
  );
  assert.equal(scoped.status, 200);
  assert.equal((await scoped.json()).state, 'pending');
  assert.equal(proposeOnly.decisions.length, 0);
  assert.equal((await proposeOnly.api.getProposal('p00001')).state, 'pending');

  const response = await reviewCuratorItem(
    request('https://grants.watch/api/v1/curator/queue/p00001/review', { body: reviewBody, idempotency: 'review-p00001-1', method: 'POST' }),
    'p00001',
    api
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.id, 'p00001');
  assert.equal(body.state, 'pending');
  assert.equal(body.verdict, 'reject');
  assert.equal(decisions.length, 0);

  const stored = await api.getProposal('p00001');
  assert.equal(stored.state, 'pending');
  assert.equal(stored.curator_review.verdict, 'reject');
  assert.equal(stored.curator_review.facts.deadline, '2026-11-15');
  assert.equal(stored.curator_review_history.length, 1);

  const replay = await reviewCuratorItem(
    request('https://grants.watch/api/v1/curator/queue/p00001/review', { body: reviewBody, idempotency: 'review-p00001-1', method: 'POST' }),
    'p00001',
    api
  );
  assert.equal(replay.status, 200);
  assert.equal(replay.headers.get('idempotent-replayed'), 'true');
  assert.equal((await api.getProposal('p00001')).curator_review_history.length, 1);

  const second = await reviewCuratorItem(
    request('https://grants.watch/api/v1/curator/queue/p00001/review', {
      body: { ...reviewBody, verdict: 'needs_owner', reason: 'Owner should confirm the office.' },
      idempotency: 'review-p00001-2',
      method: 'POST',
    }),
    'p00001',
    api
  );
  assert.equal(second.status, 200);
  assert.equal((await second.json()).verdict, 'needs_owner');
  const history = (await api.getProposal('p00001')).curator_review_history;
  assert.equal(history.length, 2);
  assert.equal(history[0].verdict, 'reject');
  assert.equal(history[1].verdict, 'needs_owner');
  assert.equal((await api.getProposal('p00001')).state, 'pending');

  const detail = await getCuratorItem(request('https://grants.watch/api/v1/curator/queue/p00001'), 'p00001', api);
  const detailBody = await detail.json();
  assert.equal(detailBody.data.state, 'pending');
  assert.equal(detailBody.data.curator_review.verdict, 'needs_owner');
  assert.equal(detailBody.data.curator_review_history.length, 2);

  const tooLong = await reviewCuratorItem(
    request('https://grants.watch/api/v1/curator/queue/p00001/review', {
      body: { ...reviewBody, reason: 'x'.repeat(301) },
      idempotency: 'review-long-1',
      method: 'POST',
    }),
    'p00001',
    api
  );
  assert.equal(tooLong.status, 400);

  const httpSource = await reviewCuratorItem(
    request('https://grants.watch/api/v1/curator/queue/p00001/review', {
      body: { ...reviewBody, sources: [{ url: 'http://example.org/grants', quote: 'Applications close on 1 December 2026.' }] },
      idempotency: 'review-http-1',
      method: 'POST',
    }),
    'p00001',
    api
  );
  assert.equal(httpSource.status, 400);

  const extraFact = await reviewCuratorItem(
    request('https://grants.watch/api/v1/curator/queue/p00001/review', {
      body: { ...reviewBody, facts: { website: 'https://example.org' } },
      idempotency: 'review-fact-1',
      method: 'POST',
    }),
    'p00001',
    api
  );
  assert.equal(extraFact.status, 400);

  const badDay = await reviewCuratorItem(
    request('https://grants.watch/api/v1/curator/queue/p00001/review', {
      body: { ...reviewBody, facts: { deadline: '15 November 2026' } },
      idempotency: 'review-day-1',
      method: 'POST',
    }),
    'p00001',
    api
  );
  assert.equal(badDay.status, 400);

  const mergeReview = await reviewCuratorItem(
    request('https://grants.watch/api/v1/curator/queue/p00002/review', { body: reviewBody, idempotency: 'review-merge-1', method: 'POST' }),
    'p00002',
    api
  );
  assert.equal(mergeReview.status, 200);
  assert.equal((await mergeReview.json()).state, 'pending');
  const mergeDecide = await decideCuratorItem(
    request('https://grants.watch/api/v1/curator/queue/p00002/decide', {
      body: { decision: 'rejected', reason: 'These are not the same organization.' },
      idempotency: 'decide-merge-still-blocked',
      method: 'POST',
    }),
    'p00002',
    api
  );
  assert.equal(mergeDecide.status, 403);
  assert.equal(decisions.length, 0);

  const deletionReview = await reviewCuratorItem(
    request('https://grants.watch/api/v1/curator/queue/p00003/review', {
      body: { verdict: 'reject', reason: 'Do not delete the file.', sources: reviewBody.sources },
      idempotency: 'review-delete-1',
      method: 'POST',
    }),
    'p00003',
    api
  );
  assert.equal(deletionReview.status, 200);
  assert.equal((await api.getProposal('p00003')).state, 'pending');

  const missing = await reviewCuratorItem(
    request('https://grants.watch/api/v1/curator/queue/p00999/review', { body: reviewBody, idempotency: 'review-missing-1', method: 'POST' }),
    'p00999',
    api
  );
  assert.equal(missing.status, 404);
});

test('a review of a decided proposal is a conflict and leaves state alone', async () => {
  const { api } = deps();
  const decided = await api.getProposal('p00001');
  decided.state = 'approved';
  const response = await reviewCuratorItem(
    request('https://grants.watch/api/v1/curator/queue/p00001/review', { body: reviewBody, idempotency: 'review-decided-1', method: 'POST' }),
    'p00001',
    api
  );
  assert.equal(response.status, 409);
  assert.equal((await api.getProposal('p00001')).state, 'approved');
  assert.equal((await api.getProposal('p00001')).curator_review, undefined);
});

test('curators can edit summaries and names and merge or retire rounds', async () => {
  const summaryText = 'Independent research on how generative AI affects young people ages 13-17, with rolling review.';
  const profileText = 'Example Foundation publishes a standing open-source grant and reviews applications in public.';
  const edited = deps();
  const summary = await proposeCuratorItem(
    request('https://grants.watch/api/v1/curator/proposals', {
      method: 'POST',
      idempotency: 'summary-example-1',
      body: {
        kind: 'fact',
        fact: 'summary',
        program_id: 'example-grants',
        summary: summaryText,
        reason: 'The program page replaces the placeholder summary.',
        sources: [source],
      },
    }),
    edited.api
  );
  assert.equal(summary.status, 201);
  assert.equal((await summary.json()).lane, 'judgment');
  assert.equal(edited.inserted[0].type, 'profile_note');
  assert.equal(edited.inserted[0].proposed_change['programs/example-grants.yaml'].summary, summaryText);

  const named = deps();
  const identity = await proposeCuratorItem(
    request('https://grants.watch/api/v1/curator/proposals', {
      method: 'POST',
      idempotency: 'identity-example-1',
      body: {
        kind: 'fact',
        fact: 'identity',
        entity: 'program',
        program_id: 'example-grants',
        name: 'Example Maintainer Grants',
        description: summaryText,
        summary: 'The program page uses a different display name.',
        reason: 'The registry name does not match the program page.',
        sources: [source],
      },
    }),
    named.api
  );
  assert.equal(identity.status, 201);
  const programPatch = named.inserted[0].proposed_change['programs/example-grants.yaml'];
  assert.equal(programPatch.name, 'Example Maintainer Grants');
  assert.equal(programPatch.summary, summaryText);
  assert.equal(programPatch.id, undefined);

  const clash = deps({
    loadRegistry: () => ({
      ...registry,
      orgs: [...registry.orgs, { ...registry.orgs[0], id: 'other-example', name: 'Other Example', aka: [] }],
    }),
  });
  assert.equal((await proposeCuratorItem(
    request('https://grants.watch/api/v1/curator/proposals', {
      method: 'POST',
      idempotency: 'identity-clash-1',
      body: {
        kind: 'fact',
        fact: 'identity',
        entity: 'org',
        org_id: 'example',
        name: 'Other Example',
        summary: 'This display name is already on file.',
        reason: 'Checking that a taken organization name is refused.',
        sources: [source],
      },
    }),
    clash.api
  )).status, 409);

  const orgProfile = deps();
  const orgEdit = await proposeCuratorItem(
    request('https://grants.watch/api/v1/curator/proposals', {
      method: 'POST',
      idempotency: 'identity-org-1',
      body: {
        kind: 'fact',
        fact: 'identity',
        entity: 'org',
        org_id: 'example',
        description: profileText,
        summary: 'The organization page describes the funder in this way.',
        reason: 'The registry profile is a placeholder.',
        sources: [source],
      },
    }),
    orgProfile.api
  );
  assert.equal(orgEdit.status, 201);
  assert.equal(orgProfile.inserted[0].proposed_change['orgs/example.yaml'].profile, profileText);
  assert.equal(orgProfile.inserted[0].proposed_change['orgs/example.yaml'].name, undefined);

  const rounds = [{
    ...registry.programs[0],
    rounds: [
      { name: 'Round 41 grants', status: 'open', opens: '2026-09-07', closes: '2026-10-07', closes_at: '2026-10-07T23:59:00Z', source: 'https://example.org/grants' },
      { name: '41', status: 'open', closes: '2026-10-07', source: 'https://dao.example.org/round-41' },
    ],
  }];
  const merged = deps({ loadRegistry: () => ({ ...registry, programs: rounds }) });
  const merge = await proposeCuratorItem(
    request('https://grants.watch/api/v1/curator/proposals', {
      method: 'POST',
      idempotency: 'round-merge-1',
      body: {
        kind: 'fact',
        fact: 'round_merge',
        program_id: 'example-grants',
        round: '41',
        into: 'Round 41 grants',
        summary: 'The round named 41 is the same call as Round 41 grants.',
        reason: 'Both listings cite the same application thread.',
        sources: [source],
      },
    }),
    merged.api
  );
  assert.equal(merge.status, 201);
  assert.equal((await merge.json()).lane, 'fact');
  const mergePatch = merged.inserted[0].proposed_change['programs/example-grants.yaml'];
  assert.equal(mergePatch.retire_round, '41');
  assert.equal(mergePatch.keep_round, 'Round 41 grants');
  assert.ok(mergePatch.sources.includes('https://dao.example.org/round-41'));
  assert.equal(mergePatch.merge, undefined);
  assert.equal(merged.inserted[0].type, 'round_update');

  const same = deps({ loadRegistry: () => ({ ...registry, programs: rounds }) });
  assert.equal((await proposeCuratorItem(
    request('https://grants.watch/api/v1/curator/proposals', {
      method: 'POST',
      idempotency: 'round-merge-same-1',
      body: {
        kind: 'fact',
        fact: 'round_merge',
        program_id: 'example-grants',
        round: '41',
        into: '41',
        summary: 'A round cannot be merged into itself.',
        reason: 'The two names are the same round.',
        sources: [source],
      },
    }),
    same.api
  )).status, 400);

  const marked = deps({ loadRegistry: () => ({ ...registry, programs: rounds }) });
  const disposition = await proposeCuratorItem(
    request('https://grants.watch/api/v1/curator/proposals', {
      method: 'POST',
      idempotency: 'round-disposition-1',
      body: {
        kind: 'fact',
        fact: 'round_disposition',
        program_id: 'example-grants',
        round: '41',
        disposition: 'duplicate',
        summary: 'The extra listing is a duplicate of the canonical round.',
        reason: 'The funder page describes one call, not two.',
        sources: [source],
      },
    }),
    marked.api
  );
  assert.equal(disposition.status, 201);
  assert.deepEqual(marked.inserted[0].proposed_change['programs/example-grants.yaml'].round_disposition, { name: '41', status: 'duplicate' });

  const status = deps();
  const statusChange = await proposeCuratorItem(
    request('https://grants.watch/api/v1/curator/proposals', {
      method: 'POST',
      idempotency: 'status-summary-1',
      body: {
        kind: 'fact',
        fact: 'status',
        entity: 'program',
        program_id: 'example-grants',
        status: 'paused',
        summary: summaryText,
        reason: 'The program page now says applications are paused.',
        sources: [source],
      },
    }),
    status.api
  );
  assert.equal(statusChange.status, 201);
  assert.equal(status.inserted[0].summary, summaryText);
  assert.equal(status.inserted[0].proposed_change['programs/example-grants.yaml'].summary, summaryText);
  assert.equal(status.inserted[0].proposed_change['programs/example-grants.yaml'].status, 'paused');

  const short = deps();
  assert.equal((await proposeCuratorItem(
    request('https://grants.watch/api/v1/curator/proposals', {
      method: 'POST',
      idempotency: 'status-short-1',
      body: {
        kind: 'fact',
        fact: 'status',
        entity: 'program',
        program_id: 'example-grants',
        status: 'paused',
        summary: 'Too short to publish.',
        reason: 'A short summary must not replace the program text.',
        sources: [source],
      },
    }),
    short.api
  )).status, 400);
});

test('the mint script prints a hash entry and does not print the token', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'curator-key-'));
  const path = join(dir, 'token');
  const { stdout } = await exec(process.execPath, [
    'scripts/create-curator-key.mjs',
    'hedwig',
    'Hedwig',
    'read_queue,decide,propose',
    '2099-01-01T00:00:00Z',
    path,
  ], { cwd: process.cwd() });
  const token = (await readFile(path, 'utf8')).trim();
  const entry = JSON.parse(stdout);
  assert.equal(stdout.includes(token), false);
  assert.equal(entry.id, 'hedwig');
  assert.equal(entry.name, 'Hedwig');
  assert.deepEqual(entry.scopes, ['read_queue', 'decide', 'propose']);
  assert.equal(entry.revoked, false);
  assert.equal(entry.sha256, createHash('sha256').update(token).digest('hex'));
  assert.equal(Object.hasOwn(entry, 'token'), false);
});
