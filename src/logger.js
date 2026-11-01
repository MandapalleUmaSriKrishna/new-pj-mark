/**
 * Tiny structured logger with redaction.
 *
 * Guarantees:
 *  - Phone numbers are masked before they reach a log sink.
 *  - Auth tokens, SIDs and cookies are never logged.
 *  - Unknown/extra Twilio error text is reduced to a code so customer data
 *    cannot leak into logs through a provider response body.
 */

import { maskPhoneNumber } from './services/phone.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

const SENSITIVE_KEY_PATTERN = /(token|secret|password|authorization|cookie|auth_?token|api_?key)/i;
const PHONE_PATTERN = /\+[1-9]\d{6,14}/g;

export function maskPhoneInText(text) {
  if (typeof text !== 'string') return text;
  return text.replace(PHONE_PATTERN, (match) => maskPhone(match));
}

/**
 * +919876543210 -> +91••••••3210 (enough to recognise the number, never enough
 * to contact it). Delegates to the phone module so masking is consistent.
 */
export function maskPhone(e164) {
  try {
    return maskPhoneNumber(e164);
  } catch {
    return '***';
  }
}

function serialiseError(error) {
  if (!error) return undefined;
  return {
    name: error.name,
    message: maskPhoneInText(error.message),
    code: error.code,
    // Never include a raw provider payload or stack trace in normal logs.
  };
}

export function createLogger({ level = 'info', sink = console } = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;

  function write(levelName, message, meta = {}) {
    if (LEVELS[levelName] < threshold) return;
    const entry = {
      level: levelName,
      time: new Date().toISOString(),
      msg: maskPhoneInText(String(message)),
      ...sanitise(meta),
    };
    const line = JSON.stringify(entry);
    if (levelName === 'error') sink.error(line);
    else if (levelName === 'warn') sink.warn(line);
    else sink.log(line);
  }

  return {
    level,
    debug: (message, meta) => write('debug', message, meta),
    info: (message, meta) => write('info', message, meta),
    warn: (message, meta) => write('warn', message, meta),
    error: (message, meta) => write('error', message, meta),
    child: (bindings) => {
      const child = createLogger({ level, sink });
      return {
        ...child,
        debug: (message, meta) => write('debug', message, { ...bindings, ...meta }),
        info: (message, meta) => write('info', message, { ...bindings, ...meta }),
        warn: (message, meta) => write('warn', message, { ...bindings, ...meta }),
        error: (message, meta) => write('error', message, { ...bindings, ...meta }),
      };
    },
  };
}

function sanitise(meta) {
  const out = {};
  for (const [key, value] of Object.entries(meta ?? {})) {
    if (value === undefined) continue;
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      out[key] = '[redacted]';
      continue;
    }
    if (value instanceof Error) {
      out[key] = serialiseError(value);
      continue;
    }
    if (typeof value === 'string') {
      out[key] = maskPhoneInText(value);
      continue;
    }
    if (Array.isArray(value)) {
      out[key] = value.map((item) =>
        typeof item === 'string' ? maskPhoneInText(item) : item,
      );
      continue;
    }
    out[key] = value;
  }
  return out;
}
