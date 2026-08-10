const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeUsPhone } = require('../lib/ringcentral-sms');

test('normalizes US phone numbers to E.164', () => {
  assert.equal(normalizeUsPhone('(510) 340-5859'), '+15103405859');
  assert.equal(normalizeUsPhone('1-510-340-5859'), '+15103405859');
});

test('rejects malformed phone numbers', () => {
  assert.equal(normalizeUsPhone('510-340'), '');
  assert.equal(normalizeUsPhone(''), '');
});
