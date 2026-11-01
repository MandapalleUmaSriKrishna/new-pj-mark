#!/usr/bin/env node
/**
 * Verify your Twilio Verify setup without opening the browser.
 *
 *   npm run check:twilio                      # credentials + service configuration
 *   npm run check:twilio -- --send +919876543210
 *   npm run check:twilio -- --check +919876543210 123456
 *
 * `--send` and `--check` perform REAL Twilio Verify API calls and consume
 * account credit. They are never simulated, and the script never prints secrets.
 */
import 'dotenv/config';
import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import { createTwilioVerifyProvider } from '../src/services/verify-provider.js';
import { normalisePhoneNumber } from '../src/services/phone.js';

const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1] ?? null;
};

const sendTo = flag('--send');
const checkIndex = args.indexOf('--check');
const checkTo = checkIndex === -1 ? null : args[checkIndex + 1] ?? null;
const checkCode = checkIndex === -1 ? null : args[checkIndex + 2] ?? null;

const green = (text) => `\u001b[32m${text}\u001b[0m`;
const red = (text) => `\u001b[31m${text}\u001b[0m`;
const dim = (text) => `\u001b[2m${text}\u001b[0m`;

function fail(message) {
  console.error(red(`✖ ${message}`));
  process.exit(1);
}

const config = loadConfig();
const logger = createLogger({ level: 'warn' });

console.log('\nOTP Shield — Twilio Verify connectivity check\n');

if (!config.twilio.configured) {
  console.error(red('✖ Twilio Verify is not configured.'));
  for (const missing of config.twilio.missingCredentials) console.error(`   • missing ${missing}`);
  console.error(dim('\nAdd the values to .env (see .env.example), then run this again.\n'));
  process.exit(1);
}

console.log(green('✔'), 'Credentials present');
console.log(`  Account SID       ${config.twilio.accountSid.slice(0, 6)}…${config.twilio.accountSid.slice(-4)}`);
console.log(`  Verify Service    ${config.twilio.verifyServiceSid.slice(0, 6)}…${config.twilio.verifyServiceSid.slice(-4)}`);
console.log(`  Auth mode         ${config.twilio.usingApiKey ? 'API key pair (recommended)' : 'Account auth token'}`);
console.log(`  Code TTL (config) ${config.otp.ttlSeconds}s`);
console.log(`  Resend cooldown   ${config.otp.resendCooldownSeconds}s\n`);

const provider = createTwilioVerifyProvider(config, logger);
const health = await provider.healthCheck();

if (!health.ok) {
  fail(`Twilio rejected the request: ${health.kind}${health.twilioCode ? ` (code ${health.twilioCode})` : ''}\n   ${health.message}`);
}

console.log(green('✔'), 'Verify Service reachable');
console.log(`  Friendly name     ${health.friendlyName}`);
console.log(`  Code length       ${health.codeLength} digits`);
console.log(`  Lookup enabled    ${health.lookupEnabled ? 'yes (line-type checks)' : 'no'}`);

if (health.codeLength !== 6) {
  console.warn(
    `\n⚠ This service issues ${health.codeLength}-digit codes, but OTP Shield expects 6.\n  Set the Verify Service code length to 6 in the Twilio Console.`,
  );
}

if (sendTo) {
  let phone;
  try {
    phone = normalisePhoneNumber(sendTo, config.otp.defaultCountry).e164;
  } catch (error) {
    fail(`Invalid destination number: ${error.message}`);
  }
  console.log(`\n→ Requesting a real SMS verification to ${phone} …`);
  const verification = await provider.startVerification({ to: phone });
  console.log(green('✔'), `Verification started — SID …${String(verification.sid).slice(-4)}, status ${verification.status}`);
  console.log(dim('  A real SMS should arrive shortly. Check it with:'));
  console.log(dim(`  npm run check:twilio -- --check ${phone} <code>\n`));
}

if (checkTo) {
  if (!/^\d{6}$/.test(checkCode ?? '')) fail('Usage: --check <phone> <6-digit-code>');
  const phone = normalisePhoneNumber(checkTo, config.otp.defaultCountry).e164;
  const result = await provider.checkVerification({ to: phone, code: checkCode });
  if (result.status === 'approved') {
    console.log(`\n${green('✔')} Code approved by Twilio Verify for ${phone} — end-to-end delivery works.`);
  } else {
    console.log(`\n${red('✖')} Twilio returned status "${result.status}" (code not approved).`);
    process.exitCode = 2;
  }
}

console.log('');
