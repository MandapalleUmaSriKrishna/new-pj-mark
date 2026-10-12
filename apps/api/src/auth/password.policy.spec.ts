import { checkPassword } from './password.policy';

describe('password policy', () => {
  const options = { minLength: 12, requireStrong: true };

  it('accepts a strong password with no personal overlap', () => {
    expect(
      checkPassword('Correct-Horse-9!battery', options, {
        email: 'jane@example.edu',
        name: 'Jane Public',
      }),
    ).toEqual([]);
  });

  it('rejects passwords shorter than the minimum', () => {
    const issues = checkPassword('Sh0rt!x', options, {});
    expect(issues.some((issue) => issue.code === 'too_short')).toBe(true);
  });

  it('requires at least three character classes', () => {
    expect(
      checkPassword('alllowercase1', options, {}).some(
        (issue) => issue.code === 'not_enough_character_classes',
      ),
    ).toBe(true);
    expect(
      checkPassword('alllowercase1!', options, {}).some(
        (issue) => issue.code === 'not_enough_character_classes',
      ),
    ).toBe(false);
  });

  it('rejects the password when it contains the email local part', () => {
    const issues = checkPassword('Jane.public!2026X', options, {
      email: 'jane.public@example.edu',
      name: 'Someone Else',
    });
    expect(issues.some((issue) => issue.code === 'contains_email')).toBe(true);
  });

  it('rejects the password when it contains a name token', () => {
    const issues = checkPassword('Public!2026Rocks', options, {
      email: 'zzz@example.edu',
      name: 'Jane Public',
    });
    expect(issues.some((issue) => issue.code === 'contains_name')).toBe(true);
  });

  it('rejects passwords from the breached-password blocklist', () => {
    for (const common of ['password123', 'qwertyuiop', 'welcome123']) {
      const issues = checkPassword(common, options, {});
      expect(issues.some((issue) => issue.code === 'too_common')).toBe(true);
    }
  });

  it('passes when strength is not required', () => {
    expect(
      checkPassword('longenoughpassword', { minLength: 12, requireStrong: false }, {}),
    ).toEqual([]);
  });
});
