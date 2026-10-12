import { z } from 'zod';

/**
 * Password policy.
 *
 * Length-first (NIST SP 800-63B): no forced character-class rotation, but a
 * real minimum length, a screen of the most common leaked passwords, and a
 * rejection of passwords derived from the account's own email or name.
 */

/** A small built-in blocklist. Swap in a full corpus (e.g. HaveIBeenPwned
 *  k-anonymity API) in production by extending `PasswordPolicy`. */
const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  'passw0rd',
  'passwort',
  '123456',
  '1234567',
  '12345678',
  '123456789',
  '1234567890',
  'qwerty',
  'qwerty123',
  'qwertyuiop',
  'abc123',
  'abcdef',
  'abcdefg',
  'letmein',
  'welcome',
  'welcome1',
  'welcome123',
  'admin',
  'admin123',
  'administrator',
  'iloveyou',
  'monkey',
  'dragon',
  'sunshine',
  'princess',
  'football',
  'baseball',
  'superman',
  'batman',
  'trustno1',
  'changeme',
  'changeme123',
  'test1234',
  'password1!',
  'p@ssw0rd',
  'p@ssword',
  'pass123',
  'pass1234',
  'krishna123',
  'krishna@123',
  'india123',
  'qazwsx',
  'master',
  'root',
  'toor',
  'guest',
  'default',
  '111111',
  '000000',
  '123123',
  '654321',
  '1q2w3e4r',
  '1qaz2wsx',
]);

export interface PasswordIssue {
  code: string;
  message: string;
}

export interface PasswordPolicyOptions {
  minLength: number;
  requireStrong: boolean;
}

export function checkPassword(
  password: string,
  opts: PasswordPolicyOptions,
  context: { email?: string; name?: string } = {},
): PasswordIssue[] {
  const issues: PasswordIssue[] = [];
  const value = password ?? '';

  if (value.length < opts.minLength) {
    issues.push({
      code: 'too_short',
      message: `Password must be at least ${opts.minLength} characters long`,
    });
  }
  if (value.length > 256) {
    issues.push({ code: 'too_long', message: 'Password must be at most 256 characters long' });
  }
  if (value.includes('\n') || value.includes('\r') || value.includes('\0')) {
    issues.push({
      code: 'control_characters',
      message: 'Password must not contain control characters',
    });
  }
  if (COMMON_PASSWORDS.has(value.toLowerCase())) {
    issues.push({
      code: 'too_common',
      message: 'That password is on the list of commonly breached passwords',
    });
  }
  if (opts.requireStrong) {
    const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) =>
      re.test(value),
    ).length;
    if (classes < 3) {
      issues.push({
        code: 'not_enough_character_classes',
        message: 'Password must mix at least three of: lowercase, uppercase, digits, symbols',
      });
    }
    if (/^(.)\1{5,}$/.test(value)) {
      issues.push({
        code: 'repeated_character',
        message: 'Password must not be a single repeated character',
      });
    }
    if (/^(012|123|234|345|456|567|678|789|890|abc|bcd|cde|qwe|asd|zxc){2,}/i.test(value)) {
      issues.push({
        code: 'sequential',
        message: 'Password must not contain long sequential runs',
      });
    }
  }
  const localPart = context.email?.split('@')[0]?.toLowerCase() ?? '';
  if (localPart && localPart.length >= 4 && value.toLowerCase().includes(localPart)) {
    issues.push({
      code: 'contains_email',
      message: 'Password must not contain part of your email address',
    });
  }
  const nameTokens = (context.name ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4);
  if (nameTokens.some((t) => value.toLowerCase().includes(t))) {
    issues.push({ code: 'contains_name', message: 'Password must not contain your name' });
  }
  return issues;
}

/** 0-4, in the spirit of zxcvbn but dependency-free and deterministic. */
export function passwordStrength(password: string): {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  issues: PasswordIssue[];
} {
  const issues = checkPassword(password, { minLength: 10, requireStrong: true });
  const len = password.length;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) =>
    re.test(password),
  ).length;
  let score = 0;
  if (len >= 8) score += 1;
  if (len >= 12) score += 1;
  if (len >= 16 && classes >= 3) score += 1;
  if (classes >= 4 && len >= 14) score += 1;
  if (issues.some((i) => i.code === 'too_common')) score = 0;
  const clamped = Math.max(0, Math.min(4, score)) as 0 | 1 | 2 | 3 | 4;
  const labels = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'];
  return { score: clamped, label: labels[clamped] as string, issues };
}

export function passwordSchema(opts: PasswordPolicyOptions) {
  return z
    .string()
    .min(opts.minLength, `Password must be at least ${opts.minLength} characters`)
    .max(256)
    .refine((v) => checkPassword(v, opts).length === 0, {
      message: 'Password does not meet the security policy',
    });
}
