import test from 'node:test';
import assert from 'node:assert/strict';
import { fundingAmountLabel, fundingLabel } from '../src/lib/funding-display.ts';

test('funding display groups native quantities without rounding or converting', () => {
  assert.equal(fundingAmountLabel({amount:'1200000',currency:'INR',unit:'currency',qualifier:'up_to'}), 'Up to INR 1,200,000');
  assert.equal(fundingAmountLabel({amount:'12345678901234567890.123456',currency:'OP',unit:'token',qualifier:'approximate'}), 'Approximately OP 12,345,678,901,234,567,890.123456 token');
  assert.equal(fundingAmountLabel({amount:'0.000001',currency:'ETH',unit:'currency'}), 'ETH 0.000001');
  assert.equal(fundingAmountLabel({amount:'0',currency:'USD',unit:'currency'}), 'USD 0');
});
test('unknown denominations and amounts stay explicit', () => {
  assert.equal(fundingAmountLabel({amount:'50000',currency:null,unit:'currency'}), 'Currency not recorded: 50,000');
  assert.equal(fundingAmountLabel({amount:null,amount_text:'$50,000; currency unknown'}), '$50,000; currency unknown');
  assert.equal(fundingAmountLabel({amount:null}), 'Amount not disclosed');
  assert.equal(fundingLabel('unknown'), 'Not established');
  assert.equal(fundingLabel('no_unsolicited'), 'Unsolicited applications not accepted');
  assert.equal(fundingLabel('in_kind'), 'In kind');
});

test('funding display preserves the shared classification vocabulary', () => {
  assert.equal(fundingLabel('api_credit'), 'API credit');
  assert.equal(fundingLabel('cloud_credit'), 'Cloud credit');
});
