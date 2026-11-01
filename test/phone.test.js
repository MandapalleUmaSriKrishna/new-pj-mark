/** E.164 normalisation and privacy-safe masking. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalisePhoneNumber,
  maskPhoneNumber,
  formatPhoneForDisplay,
} from '../src/services/phone.js';

test('normalises national formats for the selected country', () => {
  const cases = [
    ['9876543210', 'IN', '+919876543210'],
    ['098765 43210', 'IN', '+919876543210'],
    ['+91 98765 43210', 'IN', '+919876543210'],
    ['(202) 555-0123', 'US', '+12025550123'],
    ['1 202 555 0123', 'US', '+12025550123'],
    ['07911 123456', 'GB', '+447911123456'],
    ['+44 7911 123456', 'GB', '+447911123456'],
    ['50 123 4567', 'AE', '+971501234567'],
  ];

  for (const [input, country, expected] of cases) {
    assert.equal(normalisePhoneNumber(input, country).e164, expected, `${input} (${country})`);
  }
});

test('rejects invalid input with 400 invalid_phone', () => {
  const cases = [
    ['', 'IN'],
    ['   ', 'IN'],
    ['abc', 'IN'],
    ['123', 'IN'],
    ['9876543210', 'ZZ'],
    ['+1 202 555 0123', 'IN'], // international prefix disagrees with the picker
    ['+999 999 999 999', 'US'], // not a real calling code
    ['1'.repeat(40), 'US'],
    ['+91 98765 43210 ext 22', 'IN'],
  ];

  for (const [input, country] of cases) {
    assert.throws(
      () => normalisePhoneNumber(input, country),
      (error) => {
        assert.equal(error.status, 400);
        assert.ok(['invalid_phone', 'invalid_country'].includes(error.code));
        return true;
      },
      `${input} (${country}) should be rejected`,
    );
  }
});

test('rejects unsupported country codes explicitly', () => {
  assert.throws(
    () => normalisePhoneNumber('9876543210', 'XX'),
    (error) => error.code === 'invalid_country',
  );
});

test('masks numbers while keeping country code and last four digits', () => {
  assert.equal(maskPhoneNumber('+919876543210'), '+91••••••3210');
  assert.equal(maskPhoneNumber('+12025550123'), '+1••••••0123');
  assert.equal(maskPhoneNumber('+447911123456'), '+44••••••3456');
  assert.equal(maskPhoneNumber('not-a-number'), '••••••••');
  assert.equal(maskPhoneNumber(undefined), '••••••••');
});

test('formats verified numbers for display', () => {
  assert.equal(formatPhoneForDisplay('+919876543210'), '+91 98765 43210');
  assert.equal(formatPhoneForDisplay('+12025550123'), '+1 202 555 0123');
});
