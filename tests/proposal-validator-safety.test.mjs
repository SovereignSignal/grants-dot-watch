import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { neverAutoReasonFor } from '../src/lib/machine-approval-policy.ts';
import {
  blockingStagedError,
  fetchPage,
  isAuthoritativeEvidenceUrl,
  isBlockedNetworkAddress,
  isValidIsoDate,
  pageContainsDate,
  pageContainsStatusClaim,
  validateStagedChanges,
  validateProposal,
} from '../src/lib/proposal-validator.ts';

function proposal(overrides = {}) {
  return {
    id: 'safety-test',
    type: 'deadline_change',
    org: 'principles-of-intelligence',
    program: 'PIBBSS AI Safety Fellowship',
    title: 'Safety test',
    summary: 'Regression fixture',
    evidence_url: 'https://princint.ai/programs/fellowship/',
    proposed_change: {
      'programs/pibbss-fellowship.yaml': {
        rounds: [{ name: 'Winter 2026-2027 cohort', closes: '2027-07-20' }],
      },
    },
    lane: 'fact',
    state: 'pending',
    created_at: '2026-07-21T00:00:00.000Z',
    ...overrides,
  };
}

test('identity, status, creation, award, and merge classes are owner-only', async () => {
  const types = ['new_org', 'new_program', 'new_award', 'profile_note', 'status_change', 'merge_orgs'];
  for (const type of types) {
    assert.ok(neverAutoReasonFor(type), `${type} should have a policy reason`);
    const result = await validateProposal(proposal({ type }));
    assert.equal(result.pass, false, `${type} must not pass`);
    assert.equal(result.neverAuto, true, `${type} must be marked never-auto`);
  }
});

test('bogus and unsupported statuses cannot satisfy machine evidence checks', async () => {
  assert.equal(pageContainsStatusClaim('Applications are now open.', 'closed'), false);
  assert.equal(pageContainsStatusClaim('Applications are now open.', 'open'), true);

  const result = await validateProposal(
    proposal({
      type: 'round_update',
      proposed_change: {
        'programs/pibbss-fellowship.yaml': {
          rounds: [{ name: 'Winter 2026-2027 cohort', status: 'definitely-open' }],
        },
      },
    })
  );
  assert.equal(result.pass, false);
  assert.match(result.reason, /invalid status/i);
});

test('date evidence is exact, year-bearing, and calendar-valid', async () => {
  const page = 'Applications close July 20, 2026.';
  assert.equal(pageContainsDate(page, '2026-07-20'), true);
  assert.equal(pageContainsDate(page, '2027-07-20'), false);
  assert.equal(pageContainsDate('Applications close July 20.', '2026-07-20'), false);
  assert.equal(isValidIsoDate('2026-02-29'), false);
  assert.equal(isValidIsoDate('2026-99-99'), false);

  const result = await validateProposal(
    proposal({
      proposed_change: {
        'programs/pibbss-fellowship.yaml': {
          rounds: [{ name: 'Winter 2026-2027 cohort', closes: '2026-99-99' }],
        },
      },
    })
  );
  assert.equal(result.pass, false);
  assert.match(result.reason, /invalid closes date/i);
});

test('unrelated apply URLs and profile edits cannot hide in an auto fact', async () => {
  const smuggledApplyUrl = await validateProposal(
    proposal({
      proposed_change: {
        'programs/pibbss-fellowship.yaml': {
          apply_url: 'https://unrelated.example/apply',
          rounds: [{ name: 'Winter 2026-2027 cohort', closes: '2027-07-20' }],
        },
      },
    })
  );
  assert.equal(smuggledApplyUrl.pass, false);
  assert.match(smuggledApplyUrl.reason, /unsupported auto-fact fields: apply_url/i);

  const profile = await validateProposal(
    proposal({
      type: 'profile_note',
      proposed_change: {
        'programs/pibbss-fellowship.yaml': { apply_url: 'https://unrelated.example/apply' },
      },
    })
  );
  assert.equal(profile.pass, false);
  assert.equal(profile.neverAuto, true);
});

test('authoritative evidence accepts owned subdomains and explicit trusted feeds only', () => {
  const org = { website: 'https://example.org' };
  assert.equal(isAuthoritativeEvidenceUrl('https://funding.example.org/call', org, []), true);
  assert.equal(isAuthoritativeEvidenceUrl('https://example.org.evil.test/call', org, []), false);
  assert.equal(isAuthoritativeEvidenceUrl('https://trusted-feed.test/call', org, ['trusted-feed.test']), true);
});

test('safe evidence fetch blocks local, private, and link-local destinations', async () => {
  for (const url of [
    'file:///etc/passwd',
    'http://localhost/admin',
    'http://127.0.0.1/admin',
    'http://10.1.2.3/admin',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/admin',
    'http://[fe80::1]/admin',
  ]) {
    const result = await fetchPage(url, 250);
    assert.equal(result.ok, false, url);
    assert.match(result.error, /http\(s\)|localhost|private|local|link-local/i, url);
  }
  assert.equal(isBlockedNetworkAddress('192.168.1.1'), true);
  assert.equal(isBlockedNetworkAddress('::ffff:127.0.0.1'), true);
  assert.equal(isBlockedNetworkAddress('8.8.8.8'), false);

  let requests = 0;
  const privateDns = await fetchPage('https://public-name.test/call', 250, {
    lookupImpl: async () => [{ address: '10.0.0.12', family: 4 }],
    fetchImpl: async () => {
      requests++;
      return new Response('should never run', { headers: { 'content-type': 'text/html' } });
    },
  });
  assert.equal(privateDns.ok, false);
  assert.match(privateDns.error, /private|local|link-local/i);
  assert.equal(requests, 0, 'a hostname resolving privately must be blocked before fetch');
});

test('safe evidence fetch rechecks redirect targets before following them', async () => {
  let requests = 0;
  const result = await fetchPage('https://public.test/call', 1_000, {
    lookupImpl: async () => [{ address: '8.8.8.8', family: 4 }],
    fetchImpl: async () => {
      requests++;
      return new Response(null, {
        status: 302,
        headers: { location: 'http://169.254.169.254/latest/meta-data', 'content-type': 'text/html' },
      });
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /private|local|link-local/i);
  assert.equal(requests, 1, 'blocked redirect must not be fetched');
});

test('safe evidence fetch rejects unsuitable and oversized responses', async () => {
  const deps = {
    lookupImpl: async () => [{ address: '8.8.8.8', family: 4 }],
  };
  const unsuitable = await fetchPage('https://public.test/data', 1_000, {
    ...deps,
    fetchImpl: async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
  });
  assert.equal(unsuitable.ok, false);
  assert.match(unsuitable.error, /content type/i);

  const oversized = await fetchPage('https://public.test/large', 1_000, {
    ...deps,
    fetchImpl: async () => new Response('small', {
      status: 200,
      headers: { 'content-type': 'text/html', 'content-length': String(3 * 1024 * 1024) },
    }),
  });
  assert.equal(oversized.ok, false);
  assert.match(oversized.error, /exceeded/i);
});

test('staged registry validation catches schema and reference violations before write', () => {
  const original = readFileSync('registry/programs/pibbss-fellowship.yaml', 'utf8');
  const invalid = original.replace('systems: []', 'systems:\n  - system-that-does-not-exist');
  assert.notEqual(invalid, original, 'fixture should contain the expected systems field');

  const error = validateStagedChanges([
    {
      path: 'registry/programs/pibbss-fellowship.yaml',
      content: invalid,
      op: 'update',
    },
  ]);
  assert.match(error, /system-that-does-not-exist.*not in systems/i);
  assert.equal(readFileSync('registry/programs/pibbss-fellowship.yaml', 'utf8'), original, 'canonical registry must stay untouched');
});

test('a past-due round in another file does not block an unrelated approve', () => {
  const output = [
    'programs/nih-biomedical-tech-optimization-center.yaml: round "September 2026 receipt" is open with past close 2026-09-29',
    'FAIL: 1 problems across 21 systems, 417 orgs, 485 programs',
  ].join('\n');
  assert.equal(blockingStagedError(output, ['registry/orgs/arpa-e.yaml']), null);

  const mixed = [
    output,
    'orgs/arpa-e.yaml: bad status "nope"',
  ].join('\n');
  const blocking = blockingStagedError(mixed, ['registry/orgs/arpa-e.yaml']);
  assert.match(blocking, /orgs\/arpa-e.yaml: bad status/);
  assert.equal(blocking.includes('nih-biomedical'), false);
});

test('staged validation still blocks a past-due round in the file being approved', () => {
  const original = readFileSync('registry/programs/pibbss-fellowship.yaml', 'utf8');
  const stale = original.replace('status: closed', 'status: open');
  assert.notEqual(stale, original);

  const error = validateStagedChanges([
    {
      path: 'registry/programs/pibbss-fellowship.yaml',
      content: stale,
      op: 'update',
    },
  ]);
  assert.match(error, /Winter 2026-2027 cohort.*past close 2026-07-20/);
  assert.equal(readFileSync('registry/programs/pibbss-fellowship.yaml', 'utf8'), original);
});
