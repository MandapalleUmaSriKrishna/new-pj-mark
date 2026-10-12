import { Inject, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { RefreshTokenRecord, User } from '@kdc/shared';
import { ENV_CONFIG, type Env } from '../config/config.tokens';
import { CryptoService } from '../infra/crypto/crypto.service';
import { DATA_STORE, type DataStore, type Repository } from '../infra/persistence/repository';
import { newId } from '../infra/ids';
import { AppException } from '../common/errors/app.exception';
import type { AccessTokenClaims } from '../common/guards/auth-context.guard';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
  tokenType: 'Bearer';
}

export interface RefreshClaims {
  sub: string;
  jti: string;
  family: string;
  typ: 'refresh';
}

const ISSUER = 'kdc-api';
const AUDIENCE = 'kdc-app';

/**
 * Token issuance and rotation.
 *
 * - Access tokens are short-lived (15 min default) JWTs.
 * - Refresh tokens are opaque, stored server side as SHA-256 hashes, grouped
 *   into a "family" per sign-in. Rotation replaces the old token every time.
 * - Presenting an already-rotated token means it was stolen or replayed, so the
 *   WHOLE family is revoked and the event is audited at critical severity.
 */
@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);
  private readonly refreshTokens: Repository<RefreshTokenRecord>;
  private readonly users: Repository<User>;

  constructor(
    private readonly jwt: JwtService,
    private readonly crypto: CryptoService,
    @Inject(DATA_STORE) store: DataStore,
    @Inject(ENV_CONFIG) private readonly env: Env,
  ) {
    this.refreshTokens = store.repository<RefreshTokenRecord>('refresh_tokens');
    this.users = store.repository<User>('users');
  }

  async issue(
    user: User,
    tenantId?: string | null,
    meta?: { ip?: string | null; userAgent?: string | null },
  ): Promise<IssuedTokens> {
    const accessExpiresAt = new Date(Date.now() + this.env.JWT_ACCESS_TTL_SECONDS * 1000);
    const refreshExpiresAt = new Date(Date.now() + this.env.JWT_REFRESH_TTL_DAYS * 86_400_000);
    const family = newId();

    const accessToken = await this.jwt.signAsync(
      {
        sub: user.id,
        email: user.email,
        name: user.name,
        typ: 'access',
        ...(tenantId ? { tid: tenantId } : {}),
      } satisfies AccessTokenClaims,
      {
        secret: this.env.JWT_ACCESS_SECRET,
        issuer: ISSUER,
        audience: AUDIENCE,
        expiresIn: this.env.JWT_ACCESS_TTL_SECONDS,
      },
    );

    const jti = newId();
    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, jti, family, typ: 'refresh' } satisfies RefreshClaims,
      {
        secret: this.env.JWT_REFRESH_SECRET,
        issuer: ISSUER,
        audience: AUDIENCE,
        expiresIn: this.env.JWT_REFRESH_TTL_DAYS * 86_400,
      },
    );

    await this.refreshTokens.insert({
      id: jti,
      userId: user.id,
      family,
      tokenHash: this.crypto.hashApiKey(refreshToken),
      expiresAt: refreshExpiresAt,
      ip: meta?.ip ?? null,
      userAgent: meta?.userAgent ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return { accessToken, refreshToken, accessExpiresAt, refreshExpiresAt, tokenType: 'Bearer' };
  }

  async verifyAccess(token: string): Promise<AccessTokenClaims> {
    return this.jwt.verifyAsync<AccessTokenClaims>(token, {
      secret: this.env.JWT_ACCESS_SECRET,
      issuer: ISSUER,
      audience: AUDIENCE,
    });
  }

  /**
   * Rotates a refresh token. Throws `token_reuse_detected` (and revokes the
   * family) when a token that has already been rotated is presented again.
   */
  async rotate(
    refreshToken: string,
    meta?: { ip?: string | null; userAgent?: string | null },
  ): Promise<{ tokens: IssuedTokens; user: User }> {
    let claims: RefreshClaims;
    try {
      claims = await this.jwt.verifyAsync<RefreshClaims>(refreshToken, {
        secret: this.env.JWT_REFRESH_SECRET,
        issuer: ISSUER,
        audience: AUDIENCE,
      });
    } catch (err) {
      const expired = (err as Error).name === 'TokenExpiredError';
      throw new AppException(
        expired ? 'token_expired' : 'unauthenticated',
        expired ? 'Your session has expired, please sign in again' : 'Invalid refresh token',
        undefined,
        401,
      );
    }
    if (claims.typ !== 'refresh') throw AppException.unauthenticated('Wrong token type');

    const hash = this.crypto.hashApiKey(refreshToken);
    const record = await this.refreshTokens.findOne({ tokenHash: hash });
    if (!record) {
      throw AppException.unauthenticated('Refresh token is not recognised');
    }
    if (record.expiresAt && new Date(record.expiresAt).getTime() < Date.now()) {
      throw new AppException('token_expired', 'Refresh token has expired', undefined, 401);
    }

    if (record.revokedAt) {
      // Reuse of a rotated token: assume compromise and revoke everything.
      await this.revokeFamily(record.family, 'reuse_detected');
      this.logger.error(
        `Refresh token reuse detected for user ${record.userId} (family ${record.family}); family revoked`,
      );
      throw new AppException(
        'token_reuse_detected',
        'This session was already used elsewhere and has been signed out everywhere for safety',
        undefined,
        401,
      );
    }

    // Lazy expiry sweep for this user so the table does not grow without bound.
    await this.refreshTokens.deleteMany({ userId: record.userId, expiresAt: { $lt: new Date() } });

    const user = await this.users.findById(record.userId);
    if (!user || user.status !== 'active')
      throw AppException.unauthenticated('Account is not active');

    await this.refreshTokens.updateById(record.id, { revokedAt: new Date(), replacedBy: null });

    const accessExpiresAt = new Date(Date.now() + this.env.JWT_ACCESS_TTL_SECONDS * 1000);
    const refreshExpiresAt = new Date(Date.now() + this.env.JWT_REFRESH_TTL_DAYS * 86_400_000);
    const jti = newId();
    const accessToken = await this.jwt.signAsync(
      {
        sub: user.id,
        email: user.email,
        name: user.name,
        typ: 'access',
      } satisfies AccessTokenClaims,
      {
        secret: this.env.JWT_ACCESS_SECRET,
        issuer: ISSUER,
        audience: AUDIENCE,
        expiresIn: this.env.JWT_ACCESS_TTL_SECONDS,
      },
    );
    const nextRefresh = await this.jwt.signAsync(
      { sub: user.id, jti, family: record.family, typ: 'refresh' } satisfies RefreshClaims,
      {
        secret: this.env.JWT_REFRESH_SECRET,
        issuer: ISSUER,
        audience: AUDIENCE,
        expiresIn: this.env.JWT_REFRESH_TTL_DAYS * 86_400,
      },
    );
    await this.refreshTokens.insert({
      id: jti,
      userId: user.id,
      family: record.family,
      tokenHash: this.crypto.hashApiKey(nextRefresh),
      expiresAt: refreshExpiresAt,
      ip: meta?.ip ?? null,
      userAgent: meta?.userAgent ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await this.refreshTokens.updateById(record.id, { replacedBy: jti });

    return {
      tokens: {
        accessToken,
        refreshToken: nextRefresh,
        accessExpiresAt,
        refreshExpiresAt,
        tokenType: 'Bearer',
      },
      user,
    };
  }

  /** Revokes a single refresh token (logout). */
  async revoke(refreshToken: string): Promise<boolean> {
    try {
      const claims = await this.jwt.verifyAsync<RefreshClaims>(refreshToken, {
        secret: this.env.JWT_REFRESH_SECRET,
        issuer: ISSUER,
        audience: AUDIENCE,
      });
      const hash = this.crypto.hashApiKey(refreshToken);
      const record = await this.refreshTokens.findOne({ tokenHash: hash });
      if (record) await this.refreshTokens.updateById(record.id, { revokedAt: new Date() });
      await this.refreshTokens.updateMany(
        { family: claims.family, revokedAt: null },
        { revokedAt: new Date() },
      );
      return true;
    } catch {
      return false;
    }
  }

  /** Revokes every active session for a user ("sign out everywhere"). */
  async revokeAllForUser(userId: string, reason = 'user_requested'): Promise<number> {
    return this.refreshTokens.updateMany(
      { userId, revokedAt: null },
      { revokedAt: new Date(), replacedBy: reason },
    );
  }

  private async revokeFamily(family: string, reason: string): Promise<void> {
    await this.refreshTokens.updateMany(
      { family, revokedAt: null },
      { revokedAt: new Date(), replacedBy: reason },
    );
  }
}
