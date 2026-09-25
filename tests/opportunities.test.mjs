import test from 'node:test';
import assert from 'node:assert/strict';
import { dateBounds, httpUrl } from '../src/lib/opportunities.ts';
import { programFacts, deadlineTime, deadlineNotedOn, roundHistoryLabel, activeProgramsByOrg } from '../src/lib/program-facts.ts';
import { collectPrograms, queryPrograms } from '../src/lib/program-directory.ts';
import { loadRegistry } from '../src/lib/registry.ts';
import { productDateISO } from '../src/lib/round-state.ts';

const today = '2026-09-24';
const source = 'https://example.org/call';
const round = { name: 'Round one', status: 'open', opens: '2026-09-01', closes: '2026-09-30', source };
const base = { id: 'fund', name: 'Example Fund', org: 'example', wires: ['oss'], status: 'active', summary: 'Funds open source tools', sources: [source], apply_url: 'https://example.org/apply', rounds: [round], review: { checked_on: '2026-09-19', review_after: '2026-09-26', operating: 'active', intake: 'open', source, kind: 'program', relationship: 'current', intake_mode: 'rounds', round_names: ['Round one'] } };

test('public program facts do not expire with review_after or depend on an apply link', () => {
  const expected = programFacts(base, today);
  for (const patch of [
    { review: { ...base.review, review_after: '2026-09-01' } },
    { review: { ...base.review, review_after: '2026-09-24' } },
    { apply_url: undefined }, { apply_url: 'javascript:alert(1)' },
  ]) assert.deepEqual(programFacts({ ...base, ...patch }, today), expected);
  const unreviewed = programFacts({ ...base, review: undefined }, today);
  assert.equal(unreviewed.status.label, 'Active');
  assert.equal(unreviewed.howToApply.label, 'In rounds');
  assert.equal(unreviewed.nextDeadline.date, round.closes);
  assert.equal(unreviewed.nextDeadline.notedOn, null);
});

test('operating status stays separate from a passed round or review intake claim', () => {
  for (const [status, label] of [['active','Active'], ['announced','Announced'], ['paused','Paused'], ['concluded','Ended'], ['unknown','Not recorded']]) {
    assert.equal(programFacts({ ...base, status }, today).status.label, label);
  }
  const facts = programFacts({ ...base, review: { ...base.review, operating: 'paused', intake: 'closed' } }, '2026-10-01');
  assert.equal(facts.status.label, 'Active');
  assert.equal(facts.howToApply.label, 'In rounds');
  assert.equal(facts.nextDeadline, null);
  assert.equal(roundHistoryLabel(round, '2026-10-01'), 'Closed');
});

test('application method follows first-match precedence without review expiry', () => {
  const facts = patch => programFacts({ ...base, ...patch }, today).howToApply;
  assert.equal(facts({ review: { ...base.review, intake_mode: 'rolling', review_after: '2020-01-01' } }).label, 'Any time');
  assert.equal(facts({ rounds: [round, { name: 'Undated', status: 'open' }] }).label, 'Any time');
  assert.equal(facts({ review: undefined }).label, 'In rounds');
  assert.equal(facts({ rounds: [], review: { ...base.review, intake_mode: 'rounds' } }).note, 'No rounds on file.');
  assert.equal(facts({ rounds: [], review: undefined }).label, 'Not recorded');
  assert.equal(facts({ rounds: [{ name: 'Later', status: 'announced' }], review: undefined }).label, 'Not recorded');
  assert.equal(facts({ rounds: [{ name: 'Undated', status: 'open' }], review: undefined }).note, 'The funder has not published a closing date.');
});

test('round counts use recorded dates and never parse invented dates from names', () => {
  const facts = programFacts({ ...base, rounds: [{ name: 'April 2026', status: 'closed' }, round] }, today);
  assert.equal(facts.howToApply.note, 'Two rounds on file.');
  assert.equal(programFacts(base, today).howToApply.note, 'One round on file since September 2026.');
});

test('next deadline selects the earliest eligible round, including today and announced rounds', () => {
  const rounds = [round,
    { ...round, name: 'Past', closes: '2026-09-23' },
    { ...round, name: 'Reviewing', status: 'reviewing', closes: today },
    { ...round, name: 'Closed', status: 'closed', closes: today },
    { ...round, name: 'Deployed', status: 'deployed', closes: today },
    { ...round, name: 'Undated', closes: undefined },
    { ...round, name: 'Next', status: 'announced', closes: '2026-09-25' },
  ];
  assert.equal(programFacts({ ...base, rounds }, today).nextDeadline.round.name, 'Next');
  const todayRound = { ...round, name: 'Today', closes: today, closes_at: `${today}T00:01:00Z` };
  const facts = programFacts({ ...base, rounds: [...rounds, todayRound] }, today);
  assert.equal(facts.nextDeadline.round.name, 'Today');
  assert.equal(facts.nextDeadline.label, 'September 24, 2026');
  assert.equal(roundHistoryLabel(todayRound, today), 'Deadline ahead');
});

test('product midnight moves a deadline into history without changing program facts', () => {
  const p = { ...base, rounds: [{ ...round, closes: '2026-09-24' }] };
  const before = programFacts(p, productDateISO(new Date('2026-09-25T06:59:59Z')));
  const after = programFacts(p, productDateISO(new Date('2026-09-25T07:00:00Z')));
  assert.equal(before.nextDeadline.date, '2026-09-24');
  assert.equal(after.nextDeadline, null);
  assert.deepEqual(before.status, after.status);
  assert.deepEqual(before.howToApply, after.howToApply);
});

test('noted dates require a real date scoped to that round', () => {
  const fact = { value: 'September 30 at noon CET', source, checked_on: '2026-09-20' };
  const p = { ...base, review: { ...base.review, facts: { deadline: fact } } };
  assert.equal(deadlineNotedOn(p, round, today), '2026-09-20');
  assert.equal(deadlineNotedOn(base, round, today), '2026-09-19');
  assert.equal(deadlineNotedOn(p, { ...round, name: 'Other round' }, today), null);
  assert.equal(deadlineNotedOn({ ...p, review: { ...p.review, round_names: undefined } }, round, today), '2026-09-20');
  assert.equal(deadlineNotedOn({ ...base, review: { ...base.review, round_names: undefined } }, round, today), null);
  assert.equal(deadlineNotedOn({ ...p, review: { ...p.review, round_names: undefined } }, { ...round, source: 'https://example.org/other' }, today), null);
  for (const checked_on of ['2999-01-01', '2026-02-30', '2026-09']) {
    assert.equal(deadlineNotedOn({ ...base, review: { ...base.review, checked_on } }, round, today), null);
  }
});

test('deadlines cite the round source without substituting a general review source', () => {
  const facts = programFacts({ ...base, rounds: [{ ...round, source: undefined }] }, today);
  assert.equal(facts.nextDeadline.source, null);
  assert.equal(facts.nextDeadline.date, round.closes);
  assert.equal(programFacts({ ...base, rounds: [{ ...round, source: 'javascript:alert(1)' }] }, today).nextDeadline.source, null);
});

test('source clock and timezone are preserved and an offset alone never invents a zone', () => {
  const withTime = (offset, value) => {
    const r = { ...round, closes_at: `2026-09-30T12:00:00${offset}` };
    const p = { ...base, review: { ...base.review, facts: { deadline: { value, source, checked_on: today } } } };
    return deadlineTime(p, r);
  };
  assert.equal(withTime('Z', 'September 30'), '12:00 UTC');
  assert.equal(withTime('+01:00', 'Noon CET'), '12:00 CET');
  assert.equal(withTime('-07:00', '12:00 Pacific / 15:00 Eastern'), '12:00 PT');
  assert.equal(withTime('+05:30', 'No named zone'), '12:00 UTC+05:30');
  assert.equal(withTime('+02:00', 'CET'), '12:00 UTC+02:00');
  assert.equal(deadlineTime(base, round), null);
  assert.equal(deadlineTime(base, { ...round, closes_at: 'invalid' }), null);
});

test('month-only dates retain their precision and invalid dates cannot become deadlines', () => {
  assert.deepEqual(dateBounds('2026-09'), { first: '2026-09-01', last: '2026-09-30' });
  assert.equal(dateBounds('2026-02-29'), null);
  assert.equal(programFacts({ ...base, rounds: [{ ...round, closes: '2026-09' }] }, today).nextDeadline.label, 'September 2026');
  assert.equal(programFacts({ ...base, rounds: [{ ...round, closes: '2026-02-30' }] }, today).nextDeadline, null);
});

test('directory retains each program once, including missing rounds and multiple windows', () => {
  const registry = loadRegistry();
  const all = collectPrograms(registry.programs, registry.orgs, today);
  assert.equal(all.length, registry.programs.length);
  assert.equal(new Set(all.map(i => i.program.id)).size, all.length);
  assert.equal(collectPrograms([{ ...base, rounds: [round, { ...round, name: 'Second' }] }], [], today).length, 1);
  assert.equal(collectPrograms([{ ...base, rounds: undefined }], [], today)[0].facts.howToApply.label, 'In rounds');
});

test('directory query combines status and method with search, field and mechanism', () => {
  const all = collectPrograms([base, { ...base, id: 'paused', status: 'paused' }, { ...base, id: 'rolling', name: 'Another fund', mechanism: 'fellowship', review: { ...base.review, intake_mode: 'rolling' } }], [], today);
  assert.deepEqual(queryPrograms(all, { q: 'source tools', wire: 'oss', status: 'active', method: 'rounds' }).map(i => i.program.id), ['fund']);
  assert.equal(queryPrograms(all, { wire: 'ai' }).length, 0);
  assert.equal(queryPrograms(all, { mechanism: 'fellowship' })[0].program.id, 'rolling');
  assert.equal(queryPrograms(all, { mechanism: 'other' }).length, 2);
  assert.equal(queryPrograms(all, { sort: 'name' })[0].program.id, 'rolling');
});

test('active counts agree across directory and organization slices and ignore round count', () => {
  const registry = loadRegistry();
  const byOrg = activeProgramsByOrg(registry.programs);
  assert.equal([...byOrg.values()].reduce((a, b) => a + b, 0), registry.programs.filter(p => p.status === 'active').length);
  for (const [org, count] of byOrg) assert.equal(activeProgramsByOrg(registry.programs.filter(p => p.org === org)).get(org), count);
  assert.equal(activeProgramsByOrg([{ ...base, rounds: [round, round] }]).get('example'), 1);
});

test('external links reject credentials and executable protocols', () => {
  for (const value of ['javascript:alert(1)', 'https://user:secret@example.org', 'data:text/html,test', 'invalid', undefined]) assert.equal(httpUrl(value), null);
  assert.equal(httpUrl(source), source);
});
