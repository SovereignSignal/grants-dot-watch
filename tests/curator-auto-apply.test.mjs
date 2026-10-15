import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { decideCuratorBulk, proposeCuratorItem } from '../src/lib/curator-api.ts';
import { createCuratorGate } from '../src/lib/curator-auth.ts';
import {
  curatorAutoApplyEnabled,
  curatorAutoApplyTypes,
  fetchEvidencePage,
  hostMatchesRegisteredDomain,
  isPrivateAddress,
  registeredDomain,
  textHasExactHandleLink,
} from '../src/lib/curator-auto-apply.ts';
import { proposalBlocked } from '../src/lib/curator-proposals.ts';
import { buildDeskLog } from '../src/lib/desk-log.ts';
import { revertAutoApply } from '../src/lib/desk-revert.ts';
import { memoryIdempotencyStore } from '../src/lib/curator-idempotency.ts';
import { laneFor } from '../src/proposal-lanes.ts';

const exec = promisify(execFile);
const TOKEN = 'unit-test-only-token-000000000000000000';
const HASH = createHash('sha256').update(TOKEN).digest('hex');
const NOW = Date.parse('2026-06-01T00:00:00.000Z');
const PAGE = '<a href="https://x.com/example">Example</a>';
const PAGE_HASH = createHash('sha256').update(PAGE).digest('hex');

const registry = {
  orgs: [{
    id: 'example',
    name: 'Example',
    aka: [],
    systems: [],
    wires: ['ai'],
    roles: ['funder'],
    status: 'active',
    website: 'https://www.example.org',
    socials: { x: 'https://x.com/oldhandle' },
    profile: 'An example funder that ships grants.',
    sources: ['https://example.org'],
  }],
  programs: [],
};

function key(scopes) {
  return {
    id: 'elouise',
    name: 'Elouise',
    sha256: HASH,
    scopes,
    expires_at: '2099-01-01T00:00:00.000Z',
    revoked: false,
  };
}

function request(url, { method = 'POST', body, idempotency = 'auto-apply-key-1', token = TOKEN } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (idempotency) headers['idempotency-key'] = idempotency;
  return new Request(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

function harness({
  scopes = ['propose', 'apply_low_risk'],
  proposals = new Map(),
  fetchPage = async (url) => ({ ok: true, body: PAGE, hash: PAGE_HASH, url }),
  autoApplyEnabled = () => true,
  autoApplyTypes = () => new Set(['x_handle']),
} = {}) {
  const decisions = [];
  const inserted = [];
  const api = {
    gate: createCuratorGate(() => JSON.stringify([key(scopes)]), () => NOW),
    now: () => NOW,
    idempotency: memoryIdempotencyStore(() => NOW),
    listProposals: async () => [...proposals.values()],
    getProposal: async (id) => proposals.get(id) || null,
    insertProposals: async (candidates) => {
      inserted.push(candidates[0]);
      const item = candidates[0];
      const proposal = {
        id: 'p00099',
        type: item.type,
        org: item.org,
        title: item.title,
        summary: item.summary,
        evidence_url: item.evidence_url,
        proposed_change: item.proposed_change,
        lane: laneFor(item.type, item.evidence_url),
        state: 'pending',
        created_at: '2026-06-01T00:00:00.000Z',
        submitted_by: item.submitted_by,
      };
      proposals.set(proposal.id, proposal);
      return { inserted: [proposal], skipped: 0 };
    },
    decide: async (input) => {
      decisions.push(input);
      const proposal = proposals.get(input.id);
      if (proposal) proposals.set(input.id, { ...proposal, state: input.decision });
      return {
        status: 200,
        body: {
          ok: true,
          commit: 'abc123',
          proposal: { id: input.id, state: 'approved' },
          verdict: {
            proposal_id: input.id,
            decision: input.decision,
            at: '2026-06-01T00:01:00.000Z',
            note: input.note,
            by: input.by,
            curator_id: input.curator_id,
            curator_name: input.curator_name,
            auto_apply: input.auto_apply,
          },
        },
      };
    },
    saveReview: async () => ({ status: 'missing' }),
    loadRegistry: () => registry,
    preview: () => ({ changes: [], notes: [] }),
    evidence: () => null,
    fetchPage,
    autoApplyEnabled,
    autoApplyTypes,
  };
  return { api, decisions, inserted, proposals };
}

function handleBody(overrides = {}) {
  return {
    kind: 'fact',
    fact: 'x_handle',
    org_id: 'example',
    x: 'example',
    summary: 'The organization site links this X account.',
    reason: 'The official site shows the handle in the footer.',
    sources: [{
      url: 'https://blog.example.org/team',
      quote: 'Follow Example at https://twitter.com/example.',
    }],
    ...overrides,
  };
}

test('handle link checks are exact and stay on the registered site', () => {
  assert.equal(curatorAutoApplyEnabled({}), true);
  assert.equal(curatorAutoApplyEnabled({ CURATOR_AUTO_APPLY: '0' }), false);
  assert.equal(curatorAutoApplyEnabled({ CURATOR_AUTO_APPLY: '1' }), true);
  assert.deepEqual([...curatorAutoApplyTypes({})], ['x_handle']);
  assert.equal(curatorAutoApplyTypes({ CURATOR_AUTO_APPLY_TYPES: '' }).size, 0);
  assert.equal(registeredDomain('https://www.example.org/about'), 'example.org');
  assert.equal(registeredDomain('https://x.com/example'), null);
  assert.equal(hostMatchesRegisteredDomain('https://blog.example.org/team', 'example.org'), true);
  assert.equal(hostMatchesRegisteredDomain('https://example.org.evil.com/team', 'example.org'), false);
  assert.equal(hostMatchesRegisteredDomain('https://notexample.org/team', 'example.org'), false);
  assert.equal(textHasExactHandleLink('Follow Example at https://twitter.com/example.', 'example'), true);
  assert.equal(textHasExactHandleLink('https://x.com/Example/', 'example'), true);
  assert.equal(textHasExactHandleLink('https://x.com/example/status/1', 'example'), false);
  assert.equal(textHasExactHandleLink('https://x.com/exampleextra', 'example'), false);
  assert.equal(isPrivateAddress('127.0.0.1'), true);
  assert.equal(isPrivateAddress('10.1.2.3'), true);
  assert.equal(isPrivateAddress('192.168.0.5'), true);
  assert.equal(isPrivateAddress('93.184.216.34'), false);
});

test('a scoped key auto-applies an x handle when the org site quote and page agree', async () => {
  const fetched = [];
  const { api, decisions } = harness({
    fetchPage: async (url, domain) => {
      fetched.push({ url, domain });
      return { ok: true, body: PAGE, hash: PAGE_HASH, url };
    },
  });
  const response = await proposeCuratorItem(
    request('https://grants.watch/api/v1/curator/proposals', { idempotency: 'handle-ok-1', body: handleBody() }),
    api
  );
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.state, 'approved');
  assert.equal(body.auto_apply.applied, true);
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].note, 'auto: The official site shows the handle in the footer.');
  assert.equal(decisions[0].auto_apply.key_id, 'elouise');
  assert.equal(decisions[0].auto_apply.fetched_url, 'https://blog.example.org/team');
  assert.equal(decisions[0].auto_apply.page_hash, PAGE_HASH);
  assert.equal(decisions[0].auto_apply.old_value, 'https://x.com/oldhandle');
  assert.equal(decisions[0].auto_apply.new_value, 'https://x.com/example');
  assert.deepEqual(fetched, [{ url: 'https://blog.example.org/team', domain: 'example.org' }]);
});

test('domain mismatch, quote mismatch, and a page missing the link stay pending', async () => {
  const domain = harness();
  const domainResponse = await proposeCuratorItem(
    request('https://grants.watch/api/v1/curator/proposals', {
      idempotency: 'handle-domain-1',
      body: handleBody({ sources: [{ url: 'https://other.test/about', quote: 'Follow Example at https://x.com/example.' }] }),
    }),
    domain.api
  );
  assert.equal((await domainResponse.json()).auto_apply.reason, 'domain_mismatch');
  assert.equal(domain.decisions.length, 0);

  const quote = harness();
  const quoteResponse = await proposeCuratorItem(
    request('https://grants.watch/api/v1/curator/proposals', {
      idempotency: 'handle-quote-1',
      body: handleBody({ sources: [{ url: 'https://example.org/about', quote: 'The footer names @example for news.' }] }),
    }),
    quote.api
  );
  assert.equal((await quoteResponse.json()).auto_apply.reason, 'quote_mismatch');
  assert.equal(quote.decisions.length, 0);

  let fetched = 0;
  const missing = harness({
    fetchPage: async (url) => {
      fetched += 1;
      return { ok: true, body: '<p>No social link on this page.</p>', hash: 'abc', url };
    },
  });
  const missingResponse = await proposeCuratorItem(
    request('https://grants.watch/api/v1/curator/proposals', { idempotency: 'handle-missing-1', body: handleBody() }),
    missing.api
  );
  const missingBody = await missingResponse.json();
  assert.equal(missingBody.state, 'pending');
  assert.equal(missingBody.auto_apply.reason, 'page_missing_link');
  assert.equal(fetched, 1);
  assert.equal(missing.decisions.length, 0);
});

test('a key without apply_low_risk leaves a verified handle pending', async () => {
  let fetched = 0;
  const { api, decisions } = harness({
    scopes: ['propose', 'decide'],
    fetchPage: async () => {
      fetched += 1;
      return { ok: true, body: PAGE, hash: PAGE_HASH, url: 'https://blog.example.org/team' };
    },
  });
  const response = await proposeCuratorItem(
    request('https://grants.watch/api/v1/curator/proposals', { idempotency: 'handle-noscope-1', body: handleBody() }),
    api
  );
  const body = await response.json();
  assert.equal(body.state, 'pending');
  assert.equal(body.auto_apply, undefined);
  assert.equal(decisions.length, 0);
  assert.equal(fetched, 0);
});

test('the kill switch leaves an otherwise valid handle pending', async () => {
  const { api, decisions } = harness({ autoApplyEnabled: () => curatorAutoApplyEnabled({ CURATOR_AUTO_APPLY: '0' }) });
  const response = await proposeCuratorItem(
    request('https://grants.watch/api/v1/curator/proposals', { idempotency: 'handle-kill-1', body: handleBody() }),
    api
  );
  const body = await response.json();
  assert.equal(body.state, 'pending');
  assert.equal(body.auto_apply.applied, false);
  assert.equal(body.auto_apply.reason, 'disabled');
  assert.equal(decisions.length, 0);
});

test('clearing a dead handle is a field clear, stays pending on submit, and bulk-applies with evidence', async () => {
  const { api, decisions, inserted } = harness({ scopes: ['propose', 'decide', 'apply_low_risk'] });
  const response = await proposeCuratorItem(
    request('https://grants.watch/api/v1/curator/proposals', {
      idempotency: 'handle-clear-1',
      body: handleBody({ x: null, reason: 'The account returns not found and the site no longer links it.' }),
    }),
    api
  );
  const queued = await response.json();
  assert.equal(queued.state, 'pending');
  assert.equal(queued.auto_apply.reason, 'clear_not_auto');
  assert.equal(inserted[0].proposed_change['orgs/example.yaml'].socials.x, null);
  assert.equal(proposalBlocked(inserted[0]), false);
  assert.equal(JSON.stringify(inserted[0].proposed_change).includes('"remove"'), false);
  assert.equal(decisions.length, 0);

  const bulk = await decideCuratorBulk(
    request('https://grants.watch/api/v1/curator/queue/decide-bulk', {
      idempotency: 'handle-clear-bulk-1',
      body: {
        ids: ['p00099'],
        decision: 'approved',
        reason: 'The account returns not found and the site no longer links it.',
      },
    }),
    api
  );
  const applied = await bulk.json();
  assert.equal(bulk.status, 200);
  assert.deepEqual(applied.decided, ['p00099']);
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].note.startsWith('auto: '), true);
  assert.equal(decisions[0].auto_apply.old_value, 'https://x.com/oldhandle');
  assert.equal(decisions[0].auto_apply.new_value, null);
  assert.equal(decisions[0].auto_apply.fetched_url, null);

  const withoutScope = harness({ scopes: ['decide'] });
  withoutScope.proposals.set('p00099', {
    ...inserted[0],
    id: 'p00099',
    state: 'pending',
    lane: 'judgment',
    created_at: '2026-06-01T00:00:00.000Z',
  });
  const refused = await decideCuratorBulk(
    request('https://grants.watch/api/v1/curator/queue/decide-bulk', {
      idempotency: 'handle-clear-noscope-1',
      body: { ids: ['p00099'], decision: 'approved', reason: 'The account returns not found.' },
    }),
    withoutScope.api
  );
  const refusedBody = await refused.json();
  assert.deepEqual(refusedBody.failed, [{ id: 'p00099', error: 'forbidden' }]);
  assert.equal(withoutScope.decisions.length, 0);
});

test('bulk decide caps at 50, requires one type, and re-verifies each x handle', async () => {
  const tooMany = harness({ scopes: ['decide', 'apply_low_risk'] });
  const capped = await decideCuratorBulk(
    request('https://grants.watch/api/v1/curator/queue/decide-bulk', {
      idempotency: 'bulk-cap-1',
      body: {
        ids: Array.from({ length: 51 }, (_, index) => `p${index + 1}`),
        decision: 'approved',
        reason: 'Applying a batch that is over the cap.',
      },
    }),
    tooMany.api
  );
  assert.equal(capped.status, 400);

  const { api, decisions, proposals } = harness({
    scopes: ['decide'],
    fetchPage: async (url) => (
      url.endsWith('/missing')
        ? { ok: true, body: '<p>No handle here.</p>', hash: 'missing', url }
        : { ok: true, body: PAGE, hash: PAGE_HASH, url }
    ),
  });
  const stamp = {
    key_id: 'elouise',
    key_name: 'Elouise',
    reason: 'The official site shows the handle.',
    sources: ['https://blog.example.org/team'],
    quotes: [{ url: 'https://blog.example.org/team', quote: 'Follow Example at https://x.com/example.' }],
    at: '2026-06-01T00:00:00.000Z',
  };
  proposals.set('p01939', {
    id: 'p01939',
    type: 'profile_note',
    org: 'example',
    title: 'Example: X @example',
    summary: 'The organization site links this X account.',
    state: 'pending',
    lane: 'judgment',
    created_at: '2026-06-01T00:00:00.000Z',
    proposed_change: { 'orgs/example.yaml': { socials: { x: 'https://x.com/example' } } },
    submitted_by: stamp,
  });
  proposals.set('p01940', {
    id: 'p01940',
    type: 'profile_note',
    org: 'example',
    title: 'Example: X @other',
    summary: 'Another handle proposal.',
    state: 'pending',
    lane: 'judgment',
    created_at: '2026-06-01T00:00:00.000Z',
    proposed_change: { 'orgs/example.yaml': { socials: { x: 'https://x.com/other' } } },
    submitted_by: {
      ...stamp,
      sources: ['https://blog.example.org/missing'],
      quotes: [{ url: 'https://blog.example.org/missing', quote: 'Also see https://x.com/other for updates.' }],
    },
  });
  const mixed = await decideCuratorBulk(
    request('https://grants.watch/api/v1/curator/queue/decide-bulk', {
      idempotency: 'bulk-mixed-type-1',
      body: { ids: ['p01939', 'p00001'], decision: 'approved', reason: 'These should not mix types.' },
    }),
    {
      ...api,
      getProposal: async (id) => (id === 'p00001'
        ? { ...proposals.get('p01939'), id: 'p00001', type: 'deadline_change' }
        : proposals.get(id) || null),
    }
  );
  assert.equal(mixed.status, 400);

  const verified = await decideCuratorBulk(
    request('https://grants.watch/api/v1/curator/queue/decide-bulk', {
      idempotency: 'bulk-verify-1',
      body: { ids: ['p01939', 'p01940'], decision: 'approved', reason: 'Re-check each official page.' },
    }),
    api
  );
  const verifiedBody = await verified.json();
  assert.deepEqual(verifiedBody.decided, ['p01939']);
  assert.deepEqual(verifiedBody.failed, [{ id: 'p01940', error: 'page_missing_link' }]);
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].id, 'p01939');
  assert.equal(decisions[0].auto_apply.page_hash, PAGE_HASH);

  const killed = harness({
    scopes: ['decide', 'apply_low_risk'],
    autoApplyEnabled: () => false,
  });
  killed.proposals.set('p01939', { ...proposals.get('p01939'), state: 'pending' });
  const killedResponse = await decideCuratorBulk(
    request('https://grants.watch/api/v1/curator/queue/decide-bulk', {
      idempotency: 'bulk-kill-1',
      body: { ids: ['p01939'], decision: 'approved', reason: 'This batch is switched off.' },
    }),
    killed.api
  );
  assert.deepEqual((await killedResponse.json()).failed, [{ id: 'p01939', error: 'disabled' }]);
  assert.equal(killed.decisions.length, 0);
});

test('the desk log names auto-apply and revert writes the old handle back', async () => {
  const verdict = {
    proposal_id: 'p00010',
    decision: 'approved',
    at: '2026-06-01T00:05:00.000Z',
    note: 'auto: The official site shows the handle in the footer.',
    by: 'curator',
    curator_id: 'elouise',
    curator_name: 'Elouise',
    commit: 'abc123',
    auto_apply: {
      key_id: 'elouise',
      fetched_url: 'https://blog.example.org/team',
      page_hash: PAGE_HASH,
      old_value: 'https://x.com/oldhandle',
      new_value: 'https://x.com/example',
    },
  };
  const rows = buildDeskLog(
    [{
      id: 'p00010',
      title: 'Example: X @example',
      submitted_by: {
        key_id: 'elouise',
        key_name: 'Elouise',
        reason: 'The official site shows the handle in the footer.',
        sources: ['https://blog.example.org/team'],
        quotes: [],
        at: '2026-06-01T00:00:00.000Z',
      },
    }],
    [verdict]
  );
  assert.equal(rows[0].actor, 'curator · Elouise · auto-apply');
  assert.equal(rows[0].autoApplied, true);
  assert.equal(rows[0].audit.keyId, 'elouise');
  assert.equal(rows[0].audit.fetchedUrl, 'https://blog.example.org/team');
  assert.equal(rows[0].audit.pageHash, PAGE_HASH);
  assert.equal(rows[0].audit.oldValue, 'https://x.com/oldhandle');
  assert.equal(rows[0].audit.newValue, 'https://x.com/example');
  assert.equal(rows.filter((row) => row.autoApplied).map((row) => row.proposalId).join(','), 'p00010');

  const proposal = {
    id: 'p00010',
    type: 'profile_note',
    org: 'example',
    title: 'Example: X @example',
    summary: 'The organization site links this X account.',
    proposed_change: { 'orgs/example.yaml': { socials: { x: 'https://x.com/example' } } },
    lane: 'judgment',
    state: 'approved',
    created_at: '2026-06-01T00:00:00.000Z',
  };
  const applied = [];
  const marked = [];
  const deps = {
    getProposal: async () => proposal,
    listVerdicts: async () => [verdict],
    apply: async (item) => {
      applied.push(item);
      return { changes: [], notes: [], commit: 'deadbeef' };
    },
    markReverted: async (id, at, patch) => {
      marked.push({ id, at, patch });
      return { ...verdict, ...patch };
    },
    now: () => '2026-06-01T00:06:00.000Z',
  };
  const result = await revertAutoApply('p00010', deps);
  assert.equal(result.status, 200);
  assert.equal(applied[0].proposed_change['orgs/example.yaml'].socials.x, 'https://x.com/oldhandle');
  assert.equal(marked[0].patch.revert_commit, 'deadbeef');
  const again = await revertAutoApply('p00010', {
    ...deps,
    listVerdicts: async () => [{ ...verdict, reverted_at: '2026-06-01T00:06:00.000Z' }],
    apply: async () => {
      throw new Error('should not write twice');
    },
  });
  assert.equal(again.status, 409);
});

test('evidence fetch refuses private addresses, off-site redirects, and oversized pages', async () => {
  let fetched = 0;
  const blocked = await fetchEvidencePage('https://example.org/about', 'example.org', {
    lookupImpl: async () => [{ address: '127.0.0.1' }],
    fetchImpl: async () => {
      fetched += 1;
      return new Response(PAGE);
    },
  });
  assert.equal(blocked.ok, false);
  assert.equal(fetched, 0);

  const calls = [];
  const redirected = await fetchEvidencePage('https://example.org/about', 'example.org', {
    lookupImpl: async () => [{ address: '93.184.216.34' }],
    fetchImpl: async (url) => {
      calls.push(String(url));
      return new Response(null, { status: 302, headers: { location: 'https://evil.test/phish' } });
    },
  });
  assert.equal(redirected.ok, false);
  assert.deepEqual(calls, ['https://example.org/about']);

  const chunk = new Uint8Array(200_000);
  let sent = 0;
  const huge = await fetchEvidencePage('https://example.org/about', 'example.org', {
    lookupImpl: async () => [{ address: '93.184.216.34' }],
    fetchImpl: async () => new Response(new ReadableStream({
      pull(controller) {
        if (sent > 1_100_000) {
          controller.close();
          return;
        }
        controller.enqueue(chunk);
        sent += chunk.byteLength;
      },
    }), { status: 200, headers: { 'content-type': 'text/html' } }),
  });
  assert.equal(huge.ok, false);

  const page = await fetchEvidencePage('https://example.org/about', 'example.org', {
    lookupImpl: async () => [{ address: '93.184.216.34' }],
    fetchImpl: async () => new Response(PAGE, { status: 200, headers: { 'content-type': 'text/html' } }),
  });
  assert.equal(page.ok, true);
  assert.equal(page.hash, PAGE_HASH);
});

test('grant-curator-scope adds apply_low_risk without printing a bearer token', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'curator-scope-'));
  const path = join(dir, 'keys.json');
  const token = 'this-token-must-not-appear-in-stdout-000000';
  await writeFile(path, JSON.stringify([{
    id: 'elouise',
    name: 'Elouise',
    sha256: 'a'.repeat(64),
    scopes: ['read_queue', 'decide', 'propose'],
    expires_at: '2099-01-01T00:00:00Z',
    revoked: false,
  }]));
  const { stdout } = await exec(process.execPath, [
    'scripts/grant-curator-scope.mjs',
    'elouise',
    'apply_low_risk',
    '--keys-file',
    path,
  ], { cwd: process.cwd() });
  const updated = JSON.parse(stdout);
  assert.deepEqual(updated[0].scopes, ['read_queue', 'decide', 'propose', 'apply_low_risk']);
  assert.equal(stdout.includes(token), false);
  assert.equal(Object.hasOwn(updated[0], 'token'), false);

  const minted = await exec(process.execPath, [
    'scripts/create-curator-key.mjs',
    'elouise',
    'Elouise',
    'read_queue,decide,propose,apply_low_risk',
    '2099-01-01T00:00:00Z',
    join(dir, 'token'),
  ], { cwd: process.cwd() });
  assert.deepEqual(JSON.parse(minted.stdout).scopes, ['read_queue', 'decide', 'propose', 'apply_low_risk']);
  const refused = await exec(process.execPath, [
    'scripts/create-curator-key.mjs',
    'elouise',
    'Elouise',
    'read_queue,apply_everything',
    '2099-01-01T00:00:00Z',
    join(dir, 'nope'),
  ], { cwd: process.cwd() }).then(() => false, () => true);
  assert.equal(refused, true);
});
