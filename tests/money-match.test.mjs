import test from 'node:test';
import assert from 'node:assert/strict';
import { findAmountOnPage, findMoney, parseMoney, visibleMoneyText } from '../src/lib/money-match.ts';

const onPage = (amount, html) => {
  const parsed = parseMoney(amount);
  assert.ok(parsed, `parses: ${amount}`);
  return findAmountOnPage(parsed, visibleMoneyText(html))?.text ?? null;
};

test('a Wire amount parses to one currency and value in every common rendering', () => {
  const usd75k = { currency: 'USD', min: 7_500_000, max: 7_500_000, range: false };
  for (const raw of ['$75,000', '$75k', '$75K', '75,000 USD', 'USD 75,000', 'USD75,000', 'US$75,000', '$ 75,000', '$75,000.00', '75000 USD']) {
    const m = parseMoney(raw);
    assert.ok(m, raw);
    assert.deepEqual({ currency: m.currency, min: m.min, max: m.max, range: m.range }, usd75k, raw);
    assert.equal(m.upTo, false, raw);
  }
  for (const raw of ['€50.000', '€50,000', '50k EUR', '50.000 EUR', 'EUR 50 000', '€50.000,00']) {
    const m = parseMoney(raw);
    assert.ok(m, raw);
    assert.deepEqual([m.currency, m.min, m.max], ['EUR', 5_000_000, 5_000_000], raw);
  }
  for (const raw of ['$1M', '$1 million', '$1,000,000', '1,000,000 USD', '$1mm', 'USD 1 million']) {
    const m = parseMoney(raw);
    assert.ok(m, raw);
    assert.deepEqual([m.currency, m.min], ['USD', 100_000_000], raw);
  }
  assert.deepEqual([parseMoney('$1.5M').min, parseMoney('£2,500').currency, parseMoney('75,000 USDC').currency], [150_000_000, 'GBP', 'USDC']);

  const upTo = parseMoney('up to $100,000');
  assert.deepEqual([upTo.currency, upTo.min, upTo.upTo], ['USD', 10_000_000, true]);
  const range = parseMoney('$50,000–$100,000');
  assert.deepEqual([range.currency, range.min, range.max, range.range], ['USD', 5_000_000, 10_000_000, true]);
  for (const raw of ['$50,000-100,000', '$50k - $100k', '50,000–100,000 EUR', '$50,000 to $100,000']) {
    const m = parseMoney(raw);
    assert.ok(m?.range, raw);
  }
  assert.equal(parseMoney('50,000–100,000 EUR').currency, 'EUR');
});

test('an ambiguous or wordy amount does not parse', () => {
  for (const raw of [
    '', 'varies', 'TBD', '75,000', '$75,000 budget', '$75,000 per team', 'up to $10,000 per award', 'Stellar Wave 10 on Drips: $75,000 budget',
    '$50-100k', '$1.500M', '$2,500k', 'CA$75,000', 'A$75,000', '$75k+', '$5,000 USDC', '$75,000 EUR', '$75,0000', '$100,000–$50,000',
    '$5,000 or $10,000', 'between $5k and $10k', null, 75000, { size: '$75,000' },
  ]) {
    assert.equal(parseMoney(raw), null, JSON.stringify(raw));
  }
});

test('the page states the amount in each recognisable form', () => {
  const cases = [
    ['$75,000', '<p>A budget of $75,000 for the wave.</p>'],
    ['$75,000', '<p>A budget of $75k for the wave.</p>'],
    ['$75,000', '<p>Budget: 75,000 USD.</p>'],
    ['$75,000', '<p>Budget: USD 75,000.</p>'],
    ['$75,000', '<p>Budget: <strong>&#36;75,000</strong></p>'],
    ['$75,000', '<p>Budget: $75&nbsp;000</p>'],
    ['$75k', '<p>Budget: $75,000.</p>'],
    ['€50.000', '<p>Förderung bis €50.000 pro Projekt.</p>'],
    ['€50.000', '<p>Funding of 50k EUR per project.</p>'],
    ['50k EUR', '<p>Funding of &euro;50,000 per project.</p>'],
    ['$100,000', '<p>Grants of up to $100,000.</p>'],
    ['up to $100,000', '<p>Grants of up to $100k each.</p>'],
    ['$1M', '<p>A $1 million pool.</p>'],
    ['$1 million', '<p>A pool of 1,000,000 USD.</p>'],
    ['$1,000,000', '<p>A $1M pool.</p>'],
    ['$50,000–$100,000', '<p>Grants range from $50k&ndash;$100k.</p>'],
    ['$50,000-100,000', '<p>Between $50,000 and $100,000 per team.</p>'],
    ['50,000–100,000 EUR', '<p>€50,000 - €100,000</p>'],
  ];
  for (const [amount, html] of cases) assert.ok(onPage(amount, html), `${amount} on ${html}`);
  assert.equal(onPage('$75,000', '<p>A budget of $75k for the wave.</p>'), '$75k');
  assert.equal(onPage('up to $100,000', '<p>Grants of up to $100k each.</p>'), 'up to $100k');
});

test('a larger number, another currency, or a different shape never matches', () => {
  const misses = [
    ['$75,000', '<p>A budget of $175,000.</p>', 'substring of a larger number'],
    ['$75,000', '<p>A budget of $75,000,000.</p>', 'prefix of a larger number'],
    ['$75,000', '<p>A budget of $750,000.</p>', 'more digits'],
    ['$75,000', '<p>Up to $1,075,000 in total.</p>', 'grouped larger number'],
    ['$75,000', '<p>A budget of 75,000 EUR.</p>', 'wrong currency'],
    ['$75,000', '<p>A budget of €75,000.</p>', 'wrong currency symbol'],
    ['$75,000', '<p>A budget of CA$75,000.</p>', 'another dollar'],
    ['$75,000', '<p>A budget of 75,000 USDC.</p>', 'a stablecoin is not USD'],
    ['$75,000', '<p>We fund 75,000 builders.</p>', 'no currency on the page'],
    ['$75,000', '<p>Grants from $25,000–$75,000.</p>', 'a range endpoint is not a single amount'],
    ['$75,000', '<p>Awards of $75k+ each.</p>', 'an open-ended amount'],
    ['up to $100,000', '<p>Grants of $100,000.</p>', 'up to needs up to on the page'],
    ['$50,000–$100,000', '<p>Grants of $50,000 or $100,000.</p>', 'two singles are not a range'],
    ['$50,000–$100,000', '<p>Grants from $50,000–$150,000.</p>', 'a different range'],
    ['$1M', '<p>$1.5 million in total.</p>', 'a different value'],
    ['€50.000', '<p>€50.5k</p>', 'a different value'],
    ['$75,000', '<script>var budget = "$75,000";</script><p>Budget soon.</p>', 'script text is not visible'],
  ];
  for (const [amount, html, label] of misses) assert.equal(onPage(amount, html), null, label);
});

test('page scanning reads every number whole', () => {
  const found = findMoney(visibleMoneyText('<p>$175,000 then $75,000 and up to $1.5M, deadline November 30, 2026.</p>'));
  assert.deepEqual(found.map((e) => [e.text, e.min]), [['$175,000', 17_500_000], ['$75,000', 7_500_000], ['up to $1.5M', 150_000_000]]);
});
