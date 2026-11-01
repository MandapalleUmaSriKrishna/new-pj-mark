/**
 * Phone number handling: strict E.164 normalisation and privacy-safe masking.
 *
 * Numbers are parsed against libphonenumber metadata using the country the user
 * selected. Anything that is not a valid, dialable number is rejected before a
 * provider request is made (so we never spend an SMS on garbage input).
 */
import { parsePhoneNumberFromString, isSupportedCountry, getCountryCallingCode } from 'libphonenumber-js';
import { ApiError } from '../errors.js';

const MAX_INPUT_LENGTH = 32;
const ALLOWED_INPUT = /^[\d\s()+\-.]+$/;

/**
 * @param {unknown} input raw user input ("98765 43210", "+91 98765 43210", ...)
 * @param {string} country ISO-3166-1 alpha-2 country chosen in the UI
 * @returns {{ e164: string, country: string, nationalNumber: string, countryCallingCode: string }}
 * @throws {ApiError} 400 when the number is not valid
 */
export function normalisePhoneNumber(input, country) {
  if (typeof input !== 'string') {
    throw new ApiError(400, 'invalid_phone', 'Enter a phone number.');
  }
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new ApiError(400, 'invalid_phone', 'Enter a phone number.');
  }
  if (trimmed.length > MAX_INPUT_LENGTH) {
    throw new ApiError(400, 'invalid_phone', 'That phone number is too long.');
  }
  if (!ALLOWED_INPUT.test(trimmed)) {
    throw new ApiError(
      400,
      'invalid_phone',
      'Phone numbers can only contain digits, spaces, and the characters + ( ) - .',
    );
  }

  const iso = String(country ?? '').toUpperCase();
  if (!iso || !isSupportedCountry(iso)) {
    throw new ApiError(400, 'invalid_country', 'Select a supported country for this number.');
  }

  // If the user typed an international prefix, it wins over the selected country.
  const parsed = parsePhoneNumberFromString(trimmed, iso);
  if (!parsed || !parsed.isValid()) {
    throw new ApiError(
      400,
      'invalid_phone',
      `That does not look like a valid ${iso} phone number. Check the number and include the area or mobile prefix.`,
    );
  }

  // Reject "+" numbers whose calling code disagrees with the selected country,
  // so the UI country and the destination cannot silently diverge. Numbers that
  // share a calling code (e.g. GB/GG on +44) are accepted as the selection.
  const selectedCallingCode = getCountryCallingCode(iso);
  if (trimmed.startsWith('+') && parsed.countryCallingCode !== selectedCallingCode) {
    const actualIso = parsed.country ?? 'another country';
    throw new ApiError(
      400,
      'invalid_phone',
      `That number belongs to ${actualIso} (+${parsed.countryCallingCode}). Change the country selection or remove the leading +${parsed.countryCallingCode}.`,
    );
  }

  return {
    e164: parsed.number,
    country: parsed.countryCallingCode === selectedCallingCode ? iso : parsed.country || iso,
    nationalNumber: parsed.nationalNumber,
    countryCallingCode: parsed.countryCallingCode,
  };
}

/**
 * Mask a number for display and logging: +919876543210 -> +91•••••3210
 * Keeps the country calling code and the last 4 digits so the owner can
 * recognise the number without exposing it in screenshots or logs.
 */
export function maskPhoneNumber(e164) {
  if (typeof e164 !== 'string') return '•'.repeat(8);
  const parsed = parsePhoneNumberFromString(e164);
  if (!parsed) return '•'.repeat(8);
  const national = parsed.nationalNumber;
  const last4 = national.slice(-4);
  const maskedCount = Math.max(2, national.length - last4.length);
  return `+${parsed.countryCallingCode}${'•'.repeat(maskedCount)}${last4}`;
}

/** Human readable grouping for a verified number, e.g. +91 98765 43210. */
export function formatPhoneForDisplay(e164) {
  const parsed = parsePhoneNumberFromString(e164 ?? '');
  return parsed ? parsed.formatInternational() : String(e164 ?? '');
}
