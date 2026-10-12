import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV_CONFIG, type Env } from '../config/config.tokens';
import { CryptoService } from '../infra/crypto/crypto.service';
import { AppException } from '../common/errors/app.exception';

/**
 * Google OAuth 2.0 / OpenID Connect authorisation-code flow.
 *
 * Implemented directly against Google's documented endpoints rather than through
 * a strategy library, so there is no hidden session middleware, the whole flow
 * is visible in one file, and the "not configured" state can be reported
 * honestly instead of failing deep inside a third-party package.
 *
 * Endpoints used (Google's current, stable OAuth surface):
 *   - authorisation: https://accounts.google.com/o/oauth2/v2/auth
 *   - token:         https://oauth2.googleapis.com/token
 *   - userinfo:      https://openidconnect.googleapis.com/v1/userinfo
 *
 * REQUIRES: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_CALLBACK_URL.
 * Without them `configured` is false and the routes answer 503
 * `oauth_not_configured` - they never pretend to work.
 */

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const SCOPES = ['openid', 'email', 'profile'];
const STATE_TTL_SECONDS = 600;

export interface GoogleProfile {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  locale?: string;
  hd?: string; // hosted domain, present for Workspace accounts
}

export interface GoogleAuthorizationRequest {
  url: string;
  state: string;
  /** Value the client must echo back; also set as a signed cookie. */
  stateCookie: string;
}

@Injectable()
export class GoogleOAuthService {
  private readonly logger = new Logger(GoogleOAuthService.name);

  constructor(
    @Inject(ENV_CONFIG) private readonly env: Env,
    private readonly crypto: CryptoService,
  ) {}

  get configured(): boolean {
    return Boolean(this.env.GOOGLE_CLIENT_ID && this.env.GOOGLE_CLIENT_SECRET && this.callbackUrl);
  }

  get callbackUrl(): string | null {
    return (
      this.env.GOOGLE_CALLBACK_URL ??
      `${this.env.API_URL.replace(/\/$/, '')}/api/v1/auth/google/callback`
    );
  }

  /**
   * Builds the Google authorisation URL.
   *
   * The `state` value is an HMAC over a random nonce plus an expiry, so a
   * callback can be rejected if the state was forged or replayed after 10
   * minutes - this is the CSRF defence for the OAuth flow.
   */
  buildAuthorizationUrl(returnTo?: string): GoogleAuthorizationRequest {
    this.assertConfigured();
    const nonce = this.crypto.randomToken(16);
    const expires = Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS;
    const payload = `${nonce}.${expires}${returnTo ? `.${encodeReturnTo(returnTo)}` : ''}`;
    const signature = this.crypto.hmacSha256(this.env.SESSION_COOKIE_SECRET, payload);
    const state = `${payload}.${signature}`;

    const params = new URLSearchParams({
      client_id: this.env.GOOGLE_CLIENT_ID as string,
      redirect_uri: this.callbackUrl as string,
      response_type: 'code',
      scope: SCOPES.join(' '),
      state,
      access_type: 'online',
      include_granted_scopes: 'true',
      prompt: 'select_account',
    });
    return { url: `${AUTHORIZE_URL}?${params.toString()}`, state, stateCookie: state };
  }

  /** Validates the `state` returned by Google and extracts the returnTo hint. */
  verifyState(state: string): { ok: boolean; returnTo?: string; reason?: string } {
    if (!state) return { ok: false, reason: 'missing state' };
    const parts = state.split('.');
    if (parts.length < 3) return { ok: false, reason: 'malformed state' };
    const signature = parts[parts.length - 1] as string;
    const payload = parts.slice(0, -1).join('.');
    const expected = this.crypto.hmacSha256(this.env.SESSION_COOKIE_SECRET, payload);
    if (!this.crypto.safeEqual(expected, signature))
      return { ok: false, reason: 'state signature mismatch' };
    const segments = payload.split('.');
    const expires = Number(segments[1]);
    if (!Number.isFinite(expires) || expires < Math.floor(Date.now() / 1000)) {
      return { ok: false, reason: 'state expired' };
    }
    const returnTo = segments[2] ? decodeReturnTo(segments[2]) : undefined;
    return { ok: true, returnTo };
  }

  /** Exchanges the authorisation code for tokens and returns the OIDC profile. */
  async exchangeCode(code: string): Promise<GoogleProfile> {
    this.assertConfigured();
    const body = new URLSearchParams({
      code,
      client_id: this.env.GOOGLE_CLIENT_ID as string,
      client_secret: this.env.GOOGLE_CLIENT_SECRET as string,
      redirect_uri: this.callbackUrl as string,
      grant_type: 'authorization_code',
    });

    const tokenResponse = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    const tokenJson = (await tokenResponse.json().catch(() => ({}))) as Record<string, unknown>;
    if (!tokenResponse.ok || typeof tokenJson.access_token !== 'string') {
      const detail = String(
        tokenJson.error_description ?? tokenJson.error ?? `HTTP ${tokenResponse.status}`,
      );
      this.logger.error(`Google token exchange failed: ${detail}`);
      throw AppException.unauthenticated(`Google sign-in failed: ${detail}`);
    }

    const profileResponse = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokenJson.access_token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!profileResponse.ok) {
      throw AppException.unauthenticated(
        `Google could not return your profile (HTTP ${profileResponse.status})`,
      );
    }
    const profile = (await profileResponse.json()) as GoogleProfile;
    if (!profile?.sub || !profile?.email) {
      throw AppException.unauthenticated('Google returned a profile without an email address');
    }
    return profile;
  }

  /** Configuration status for the UI, so the button can be disabled honestly. */
  status(): {
    configured: boolean;
    clientIdHint: string | null;
    callbackUrl: string | null;
    missing: string[];
  } {
    const missing: string[] = [];
    if (!this.env.GOOGLE_CLIENT_ID) missing.push('GOOGLE_CLIENT_ID');
    if (!this.env.GOOGLE_CLIENT_SECRET) missing.push('GOOGLE_CLIENT_SECRET');
    if (!this.callbackUrl) missing.push('GOOGLE_CALLBACK_URL');
    return {
      configured: this.configured,
      // Only a hint is exposed publicly - never the full client id.
      clientIdHint: this.env.GOOGLE_CLIENT_ID ? `${this.env.GOOGLE_CLIENT_ID.slice(0, 12)}…` : null,
      callbackUrl: this.configured ? this.callbackUrl : null,
      missing,
    };
  }

  private assertConfigured(): void {
    if (!this.configured) {
      throw AppException.serviceUnavailable(
        'Google sign-in is not configured on this deployment. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_CALLBACK_URL.',
        'oauth_not_configured',
      );
    }
  }
}

function encodeReturnTo(returnTo: string): string {
  // Only same-origin paths are allowed, which stops an open redirect through
  // the OAuth callback.
  const safe = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/app';
  return Buffer.from(safe, 'utf8').toString('base64url');
}

function decodeReturnTo(value: string): string {
  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8');
    return decoded.startsWith('/') && !decoded.startsWith('//') ? decoded : '/app';
  } catch {
    return '/app';
  }
}
