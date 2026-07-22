import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import YAML from 'yaml';

function audit(root) {
  return JSON.parse(execFileSync(process.execPath, ['scripts/audit-program-quality.mjs', '--json'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, PROGRAM_AUDIT_ROOT: root },
  }));
}

test('semantic audit catches forum submissions and non-program artifacts', () => {
  const root = mkdtempSync(join(tmpdir(), 'program-quality-'));
  for (const directory of ['orgs', 'programs', 'systems', 'awards']) mkdirSync(join(root, directory));
  writeFileSync(join(root, 'orgs', 'funder.yaml'), YAML.stringify({
    id: 'funder',
    name: 'Funder',
    website: 'https://funder.example/',
  }));

  const fixtures = [
    {
      id: 'applicant',
      name: 'Infrastructure Grant',
      summary: 'An applicant submission.',
      sources: ['https://forum.example/t/grant-application-example/1'],
      signal: 'applicant-submission',
    },
    {
      id: 'nomination',
      name: 'Retro Round 4',
      summary: 'A project nomination.',
      sources: ['https://forum.example/t/nomination-example/2'],
      signal: 'applicant-submission',
    },
    {
      id: 'question',
      name: 'Builder Rewards',
      summary: 'A participant question.',
      sources: ['https://forum.example/t/how-can-i-participate/3'],
      signal: 'help-request',
    },
    {
      id: 'directory',
      name: 'Ecosystem Funding Map',
      summary: 'A directory of opportunities.',
      sources: ['https://funder.example/map'],
      signal: 'directory-or-map',
    },
    {
      id: 'proposal',
      name: 'Education Initiative',
      summary: 'I am proposing a content initiative for the ecosystem.',
      sources: ['https://forum.example/t/education/4'],
      signal: 'proposal-artifact',
    },
    {
      id: 'grant-proposal',
      name: 'Example Events Grant Proposal',
      summary: 'A request for an event sponsorship.',
      sources: ['https://forum.example/t/events/5'],
      signal: 'proposal-artifact-title',
    },
    {
      id: 'retrospective',
      name: 'Round 4 Retrospective',
      summary: 'A review of the completed round.',
      sources: ['https://forum.example/t/round-review/6'],
      signal: 'retrospective-or-digest',
    },
    {
      id: 'award-story',
      name: 'Foundation Grant to Example Labs',
      summary: 'One recipient received a grant.',
      sources: ['https://news.example/award/7'],
      signal: 'single-award-story',
    },
    {
      id: 'prompt-leak',
      name: 'Example Fund',
      summary: 'The prompt says to include the amount and we need to lead with the program name.',
      sources: ['https://example.org/fund'],
      signal: 'prompt-leak',
    },
    {
      id: 'editorial-prompt-leak',
      name: 'Another Fund',
      summary: 'No amount given, so provide plain prose under 100 words and just include the source.',
      sources: ['https://example.org/another-fund'],
      signal: 'prompt-leak',
    },
    {
      id: 'dispatch-placeholder',
      name: 'Wire Dispatch',
      summary: 'Dispatch from the wire, no further detail on file.',
      sources: ['https://example.org/wire-dispatch'],
      signal: 'dispatch-placeholder',
    },
    {
      id: 'homepage-apply',
      name: 'Unverified Opportunity',
      summary: 'No application endpoint is documented.',
      apply_url: 'https://funder.example/',
      sources: ['https://news.example/opportunity'],
      signal: 'homepage-only-apply',
    },
    {
      id: 'truncated-summary',
      name: 'Clipped Program',
      summary: `${'A source-backed sentence with useful program context. '.repeat(5)}This sentence was cut in th`,
      sources: ['https://example.org/clipped'],
      signal: 'summary-truncated',
    },
    {
      id: 'forum-proposal',
      name: 'Committee Funding',
      summary: 'A committee submitted an operating budget request.',
      sources: ['https://forum.example/t/budget-request-committee/9'],
      signal: 'forum-proposal-source',
    },
    {
      id: 'secured-funding',
      name: 'University Secures Funding',
      summary: 'A news story about a single recipient.',
      sources: ['https://news.example/award/10'],
      signal: 'single-award-story',
    },
    {
      id: 'partnership',
      name: 'Platform Partners with Foundation',
      summary: 'A partnership pilot rather than an applicant funding program.',
      sources: ['https://news.example/partnership/11'],
      signal: 'partnership-story',
    },
    {
      id: 'umbrella-announcement',
      name: 'Network Announces Grant Programs',
      summary: 'An umbrella announcement duplicating canonical program records.',
      sources: ['https://news.example/announcement/12'],
      signal: 'umbrella-announcement',
    },
    {
      id: 'unsupported',
      name: 'Unverified Credits Program',
      summary: 'A placeholder record without evidence.',
      sources: ['https://manual/needs-source/13'],
      signal: 'unsupported-placeholder',
    },
    {
      id: 'applicant-feedback',
      name: 'Clinical Trial Funding',
      summary: 'I am preparing an Expression of Interest and would value feedback on the EOI.',
      sources: ['https://forum.example/t/feedback/14'],
      signal: 'applicant-feedback',
    },
    {
      id: 'participant-funded',
      name: 'Founder Residency',
      summary: 'A month-long residency with a program fee paid in cash or equity.',
      sources: ['https://residency.example/apply'],
      signal: 'participant-funded-program',
    },
    {
      id: 'enriched-directory',
      name: 'Ecosystem Funding Directory',
      summary: 'A maintained directory of ecosystem funding routes and contacts rather than a grant program.',
      sources: ['https://directory.example/funding'],
      signal: 'directory-or-map',
      enriched: true,
    },
  ];

  for (const fixture of fixtures) {
    writeFileSync(join(root, 'programs', `${fixture.id}.yaml`), YAML.stringify({
      id: fixture.id,
      name: fixture.name,
      org: 'funder',
      status: fixture.enriched ? 'active' : 'unknown',
      mechanism: fixture.enriched ? 'grants' : undefined,
      systems: fixture.enriched ? ['test-system'] : [],
      rounds: fixture.enriched
        ? [{ name: 'Current call', status: 'open', closes: '2099-01-01', source: fixture.sources[0] }]
        : [],
      summary: fixture.summary,
      apply_url: fixture.apply_url,
      sources: fixture.sources,
    }));
  }

  const { candidates } = audit(root);
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));

  for (const fixture of fixtures) {
    assert.ok(byId.get(fixture.id)?.signals.includes(fixture.signal), `${fixture.id} missing ${fixture.signal}`);
  }
});
