import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Membership, Tenant, User } from '@kdc/shared';
import { DEFAULT_LOCALE, permissionsForRole, type Role } from '@kdc/shared';
import { ENV_CONFIG, type Env } from '../config/config.tokens';
import { CryptoService } from '../infra/crypto/crypto.service';
import {
  DATA_STORE,
  DuplicateKeyError,
  type DataStore,
  type Repository,
} from '../infra/persistence/repository';
import { newId } from '../infra/ids';
import { AppException } from '../common/errors/app.exception';
import { AuditService } from '../audit/audit.service';
import { TenantsService } from '../tenants/tenants.service';
import { NotificationsService } from '../notifications/notifications.service';
import { welcomeEmail } from '../notifications/email-templates';
import { TokenService, type IssuedTokens } from './token.service';
import type { GoogleProfile } from './google-oauth.service';
import type { AcceptInvitationInput, ChangePasswordInput, LoginInput, RegisterInput } from './dto';
import { checkPassword } from './password.policy';

export interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string;
}

export interface AuthResult {
  user: PublicUser;
  tokens: IssuedTokens;
  tenants: TenantSummary[];
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  avatarUrl: string | null;
  locale: string;
  mfaEnabled: boolean;
  hasPassword: boolean;
  googleConnected: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface InvitationDetails {
  email: string;
  name: string;
  tenantName: string;
  role: Role;
  expiresAt: string | null;
  /** False while the account is still password-less; accept then sets it. */
  hasPassword: boolean;
}

export type AcceptInvitationResult = AuthResult & {
  tenantId: string;
  tenantName: string;
  role: Role;
};

export interface TenantSummary {
  id: string;
  name: string;
  slug: string;
  type: string;
  planId: string;
  role: string;
  permissions: string[];
  branding: Tenant['branding'];
  settings: Tenant['settings'];
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerified: user.emailVerified,
    avatarUrl: user.avatarUrl ?? null,
    locale: user.locale ?? DEFAULT_LOCALE,
    mfaEnabled: user.mfaEnabled,
    hasPassword: Boolean(user.passwordHash),
    googleConnected: Boolean(user.googleId),
    lastLoginAt: user.lastLoginAt ? new Date(user.lastLoginAt).toISOString() : null,
    createdAt: new Date(user.createdAt).toISOString(),
  };
}

/**
 * Authentication and account lifecycle.
 *
 * Security properties worth calling out:
 *  - Failed logins are audited and answered with a generic message, and the
 *    password check still runs against a dummy hash so timing does not reveal
 *    whether the account exists.
 *  - Argon2id hashes are transparently upgraded when parameters change.
 *  - Google sign-in links to an existing account only when the provider asserts
 *    the email is verified; otherwise it refuses rather than allowing account
 *    takeover through an unverified provider address.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly users: Repository<User>;
  private readonly memberships: Repository<Membership>;
  private readonly tenants: Repository<Tenant>;
  /** Constant-work dummy hash so a missing account costs the same time. */
  private dummyHash: string | null = null;

  constructor(
    @Inject(DATA_STORE) store: DataStore,
    private readonly crypto: CryptoService,
    private readonly tokens: TokenService,
    private readonly tenantsService: TenantsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    @Inject(ENV_CONFIG) private readonly env: Env,
  ) {
    this.users = store.repository<User>('users');
    this.memberships = store.repository<Membership>('memberships');
    this.tenants = store.repository<Tenant>('tenants');
  }

  /* ------------------------------------------------------------- register */

  async register(input: RegisterInput, meta: RequestMeta = {}): Promise<AuthResult> {
    const email = input.email.toLowerCase();
    const issues = checkPassword(
      input.password,
      {
        minLength: this.env.MIN_PASSWORD_LENGTH,
        requireStrong: this.env.REQUIRE_STRONG_PASSWORDS,
      },
      { email, name: input.name },
    );
    if (issues.length > 0) {
      throw AppException.validationFailed('Password does not meet the security policy', issues);
    }

    const existing = await this.users.findOne({ email });
    if (existing) {
      // Do not disclose whether the address is registered.
      await this.audit.record({
        actorEmail: email,
        actorRole: 'anonymous',
        action: 'auth.login_failed',
        entityType: 'user',
        entityId: existing.id,
        payload: { reason: 'register_email_taken' },
        severity: 'warning',
        ...meta,
      });
      throw new AppException(
        'email_taken',
        'An account with that email already exists',
        undefined,
        409,
      );
    }

    const now = new Date();
    const user: User = {
      id: newId(),
      email,
      emailVerified: false,
      name: input.name.trim(),
      passwordHash: await this.crypto.hashPassword(input.password),
      googleId: null,
      googleEmail: null,
      avatarUrl: null,
      locale: input.locale ?? DEFAULT_LOCALE,
      status: 'active',
      lastLoginAt: now,
      mfaEnabled: false,
      refreshTokenFamily: null,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await this.users.insert(user);
    } catch (err) {
      if (err instanceof DuplicateKeyError) {
        throw new AppException(
          'email_taken',
          'An account with that email already exists',
          undefined,
          409,
        );
      }
      throw err;
    }

    let tenantSummary: TenantSummary | null = null;
    if (input.organisation) {
      const provisioned = await this.tenantsService.provision(user, {
        name: input.organisation.name,
        slug: input.organisation.slug,
        type: input.organisation.type,
        country: input.organisation.country,
        locale: input.locale,
      });
      tenantSummary = summarise(provisioned.tenant, provisioned.membership);
      await this.queueWelcomeEmail(user, provisioned.tenant);
    }

    await this.audit.record({
      tenantId: tenantSummary?.id ?? null,
      actorId: user.id,
      actorEmail: user.email,
      actorRole: tenantSummary ? 'owner' : 'anonymous',
      action: 'auth.login',
      entityType: 'user',
      entityId: user.id,
      payload: { reason: 'registered', organisation: input.organisation?.name ?? null },
      ...meta,
    });

    const tokens = await this.tokens.issue(user, tenantSummary?.id ?? null, meta);
    return { user: toPublicUser(user), tokens, tenants: tenantSummary ? [tenantSummary] : [] };
  }

  /* ---------------------------------------------------------------- login */

  async login(input: LoginInput, meta: RequestMeta = {}): Promise<AuthResult> {
    const email = input.email.toLowerCase();
    const user = await this.users.findOne({ email });

    if (!user) {
      // Spend the same CPU as a real verification to avoid a user-enumeration
      // timing oracle.
      if (!this.dummyHash) this.dummyHash = await this.crypto.hashPassword('kdc-timing-equaliser');
      await this.crypto.verifyPassword(this.dummyHash, input.password);
      await this.audit.record({
        actorEmail: email,
        actorRole: 'anonymous',
        action: 'auth.login_failed',
        entityType: 'user',
        entityId: null,
        payload: { reason: 'unknown_email' },
        severity: 'warning',
        ...meta,
      });
      throw AppException.invalidCredentials();
    }

    if (user.status !== 'active') {
      await this.audit.record({
        tenantId: null,
        actorId: user.id,
        actorEmail: user.email,
        actorRole: 'anonymous',
        action: 'auth.login_failed',
        entityType: 'user',
        entityId: user.id,
        payload: { reason: `account_${user.status}` },
        severity: 'warning',
        ...meta,
      });
      throw AppException.forbidden('This account is not active. Contact your administrator.');
    }

    if (!user.passwordHash) {
      await this.audit.record({
        actorId: user.id,
        actorEmail: user.email,
        actorRole: 'anonymous',
        action: 'auth.login_failed',
        entityType: 'user',
        entityId: user.id,
        payload: { reason: 'password_login_disabled_use_google' },
        severity: 'warning',
        ...meta,
      });
      throw AppException.invalidCredentials('This account signs in with Google');
    }

    const ok = await this.crypto.verifyPassword(user.passwordHash, input.password);
    if (!ok) {
      await this.audit.record({
        actorId: user.id,
        actorEmail: user.email,
        actorRole: 'anonymous',
        action: 'auth.login_failed',
        entityType: 'user',
        entityId: user.id,
        payload: { reason: 'bad_password' },
        severity: 'warning',
        ...meta,
      });
      throw AppException.invalidCredentials();
    }

    let currentUser = user;
    if (this.crypto.needsRehash(user.passwordHash)) {
      const upgraded = await this.crypto.hashPassword(input.password);
      const updated = await this.users.updateById(user.id, { passwordHash: upgraded });
      if (updated) currentUser = updated;
      this.logger.log(`Upgraded password hash parameters for user ${user.id}`);
    }
    currentUser =
      (await this.users.updateById(currentUser.id, { lastLoginAt: new Date() })) ?? currentUser;

    const tenants = await this.listTenants(currentUser.id);
    await this.audit.record({
      tenantId: tenants[0]?.id ?? null,
      actorId: currentUser.id,
      actorEmail: currentUser.email,
      actorRole: (tenants[0]?.role as 'owner') ?? 'viewer',
      action: 'auth.login',
      entityType: 'user',
      entityId: currentUser.id,
      payload: { method: 'password', tenants: tenants.length },
      ...meta,
    });

    const tokens = await this.tokens.issue(currentUser, tenants[0]?.id ?? null, meta);
    return { user: toPublicUser(currentUser), tokens, tenants };
  }

  /* --------------------------------------------------------- invitations */

  /**
   * Invitations are magic links: possession of the token proves control of the
   * mailbox it was sent to. Describing an invitation therefore leaks nothing an
   * attacker without the link could learn, and lets the invite page show the
   * right context before the recipient signs in.
   */
  async describeInvitation(token: string): Promise<InvitationDetails> {
    const { membership, user, tenant } = await this.loadInvitation(token);
    return {
      email: user.email,
      name: user.name,
      tenantName: tenant.name,
      role: membership.role,
      expiresAt: membership.inviteExpiresAt
        ? new Date(membership.inviteExpiresAt).toISOString()
        : null,
      hasPassword: Boolean(user.passwordHash),
    };
  }

  /**
   * Accepts an invitation.
   *
   *  - A signed-in user whose id matches the membership simply activates it.
   *  - A password-less invited account sets its FIRST password here, because
   *    the link already proves mailbox ownership. Accounts that already have a
   *    password must sign in first, so a forwarded link cannot take them over.
   */
  async acceptInvitation(
    input: AcceptInvitationInput,
    actorId: string | null,
    meta: RequestMeta = {},
  ): Promise<AcceptInvitationResult> {
    const { membership, user, tenant } = await this.loadInvitation(input.token);
    if (actorId && actorId !== user.id) {
      throw AppException.forbidden(
        `This invitation was issued to ${user.email}; sign in with that account to accept it`,
      );
    }

    let currentUser = user;
    if (!user.passwordHash) {
      if (!input.password) {
        throw AppException.validationFailed('Choose a password to activate this account', [
          { code: 'required', message: 'A password is required to activate this account' },
        ]);
      }
      const issues = checkPassword(
        input.password,
        {
          minLength: this.env.MIN_PASSWORD_LENGTH,
          requireStrong: this.env.REQUIRE_STRONG_PASSWORDS,
        },
        { email: user.email, name: user.name },
      );
      if (issues.length > 0)
        throw AppException.validationFailed('Password does not meet the security policy', issues);
      const updated = await this.users.updateById(user.id, {
        passwordHash: await this.crypto.hashPassword(input.password),
        status: 'active',
        emailVerified: true,
      });
      if (!updated) throw AppException.notFound('Invited account');
      currentUser = updated;
    } else if (!actorId) {
      throw AppException.unauthenticated(
        'This account already has a password: sign in first, then accept the invitation',
      );
    } else if (currentUser.status !== 'active') {
      const activated = await this.users.updateById(currentUser.id, {
        status: 'active',
        emailVerified: true,
      });
      if (activated) currentUser = activated;
    }

    const updatedMembership = await this.memberships.updateById(membership.id, {
      status: 'active',
      inviteToken: null,
      inviteExpiresAt: null,
      joinedAt: new Date(),
    });
    if (!updatedMembership) throw AppException.notFound('Invitation');

    const tenants = await this.listTenants(currentUser.id);
    await this.audit.record({
      tenantId: tenant.id,
      actorId: currentUser.id,
      actorEmail: currentUser.email,
      actorRole: updatedMembership.role,
      action: 'member.joined',
      entityType: 'membership',
      entityId: membership.id,
      payload: { role: updatedMembership.role, email: currentUser.email },
      ...meta,
    });

    const tokens = await this.tokens.issue(currentUser, tenant.id, meta);
    return {
      user: toPublicUser(currentUser),
      tokens,
      tenants,
      tenantId: tenant.id,
      tenantName: tenant.name,
      role: updatedMembership.role,
    };
  }

  private async loadInvitation(
    token: string,
  ): Promise<{ membership: Membership; user: User; tenant: Tenant }> {
    const membership = await this.memberships.findOne({ inviteToken: token });
    if (!membership) throw AppException.notFound('Invitation');
    if (membership.status !== 'invited')
      throw AppException.conflict('That invitation has already been used');
    if (membership.inviteExpiresAt && new Date(membership.inviteExpiresAt).getTime() < Date.now()) {
      throw AppException.conflict(
        'That invitation has expired; ask an administrator to send a new one',
      );
    }
    const user = await this.users.findById(membership.userId);
    if (!user) throw AppException.notFound('Invited account');
    const tenant = await this.tenants.findById(membership.tenantId);
    if (!tenant || tenant.deletedAt) throw AppException.notFound('Organisation');
    return { membership, user, tenant };
  }

  /* --------------------------------------------------------- google oauth */

  async signInWithGoogle(profile: GoogleProfile, meta: RequestMeta = {}): Promise<AuthResult> {
    const email = profile.email.toLowerCase();
    if (!profile.email_verified) {
      // Refusing here prevents account takeover via an unverified provider email.
      throw AppException.forbidden('Google reports this email address as unverified');
    }

    const now = new Date();
    let user = profile.sub ? await this.users.findOne({ googleId: profile.sub }) : null;
    let linked = false;

    if (!user) user = await this.users.findOne({ email });

    if (user) {
      const patch: Record<string, unknown> = { lastLoginAt: now };
      if (!user.googleId) {
        // First Google sign-in for an existing password account: link it.
        patch.googleId = profile.sub;
        patch.googleEmail = email;
        patch.emailVerified = true;
        linked = true;
      }
      if (profile.picture && !user.avatarUrl) patch.avatarUrl = profile.picture;
      if (profile.name && !user.name) patch.name = profile.name;
      user = (await this.users.updateById(user.id, patch)) ?? user;
      if (user.status !== 'active') throw AppException.forbidden('This account is not active');
    } else {
      user = {
        id: newId(),
        email,
        emailVerified: true,
        name: profile.name ?? profile.email.split('@')[0] ?? 'Google user',
        passwordHash: null,
        googleId: profile.sub,
        googleEmail: email,
        avatarUrl: profile.picture ?? null,
        locale: (profile.locale as User['locale']) ?? DEFAULT_LOCALE,
        status: 'active',
        lastLoginAt: now,
        mfaEnabled: false,
        refreshTokenFamily: null,
        createdAt: now,
        updatedAt: now,
      };
      try {
        await this.users.insert(user);
      } catch (err) {
        if (err instanceof DuplicateKeyError) {
          const raced = await this.users.findOne({ email });
          if (!raced) throw err;
          user = raced;
        } else {
          throw err;
        }
      }
    }

    const tenants = await this.listTenants(user.id);
    await this.audit.record({
      tenantId: tenants[0]?.id ?? null,
      actorId: user.id,
      actorEmail: user.email,
      actorRole: (tenants[0]?.role as 'owner') ?? 'viewer',
      action: linked ? 'auth.google_connected' : 'auth.login',
      entityType: 'user',
      entityId: user.id,
      payload: { method: 'google', hostedDomain: profile.hd ?? null, linked },
      ...meta,
    });

    const tokens = await this.tokens.issue(user, tenants[0]?.id ?? null, meta);
    return { user: toPublicUser(user), tokens, tenants };
  }

  /* ------------------------------------------------------------------ me */

  async me(userId: string): Promise<{ user: PublicUser; tenants: TenantSummary[] }> {
    const user = await this.users.findById(userId);
    if (!user) throw AppException.unauthenticated('Account no longer exists');
    return { user: toPublicUser(user), tenants: await this.listTenants(userId) };
  }

  async listTenants(userId: string): Promise<TenantSummary[]> {
    const memberships = await this.memberships.find(
      { userId, status: 'active' },
      { sort: { createdAt: 1 } },
    );
    const out: TenantSummary[] = [];
    for (const membership of memberships) {
      const tenant = await this.tenants.findById(membership.tenantId);
      if (!tenant || tenant.deletedAt) continue;
      out.push(summarise(tenant, membership));
    }
    return out;
  }

  /* ------------------------------------------------------------- password */

  async changePassword(
    userId: string,
    input: ChangePasswordInput,
    meta: RequestMeta = {},
  ): Promise<{ ok: true }> {
    const user = await this.users.findById(userId);
    if (!user) throw AppException.unauthenticated();
    if (!user.passwordHash) {
      throw AppException.validationFailed(
        'This account signs in with Google and has no password to change',
      );
    }
    const ok = await this.crypto.verifyPassword(user.passwordHash, input.currentPassword);
    if (!ok) {
      await this.audit.record({
        actorId: user.id,
        actorEmail: user.email,
        actorRole: 'admin',
        action: 'auth.login_failed',
        entityType: 'user',
        entityId: user.id,
        payload: { reason: 'bad_current_password_on_change' },
        severity: 'warning',
        ...meta,
      });
      throw AppException.invalidCredentials('Your current password is incorrect');
    }
    const issues = checkPassword(
      input.newPassword,
      {
        minLength: this.env.MIN_PASSWORD_LENGTH,
        requireStrong: this.env.REQUIRE_STRONG_PASSWORDS,
      },
      { email: user.email, name: user.name },
    );
    if (issues.length > 0)
      throw AppException.validationFailed('New password does not meet the security policy', issues);
    if (await this.crypto.verifyPassword(user.passwordHash, input.newPassword)) {
      throw AppException.validationFailed('Choose a new password you have not used before');
    }

    await this.users.updateById(user.id, {
      passwordHash: await this.crypto.hashPassword(input.newPassword),
    });
    // A password change invalidates every other session.
    const revoked = await this.tokens.revokeAllForUser(user.id, 'password_changed');
    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      actorRole: 'admin',
      action: 'auth.password_changed',
      entityType: 'user',
      entityId: user.id,
      payload: { sessionsRevoked: revoked },
      severity: 'warning',
      ...meta,
    });
    return { ok: true };
  }

  /* -------------------------------------------------------------- logout */

  async logout(
    refreshToken: string | null | undefined,
    meta: RequestMeta = {},
  ): Promise<{ ok: true }> {
    if (refreshToken) {
      await this.tokens.revoke(refreshToken);
      await this.audit.record({
        actorRole: 'anonymous',
        action: 'auth.logout',
        entityType: 'user',
        entityId: null,
        payload: {},
        ...meta,
      });
    }
    return { ok: true };
  }

  /* -------------------------------------------------------------- helpers */

  private async queueWelcomeEmail(user: User, tenant: Tenant): Promise<void> {
    const { subject, text, html } = welcomeEmail({
      name: user.name,
      tenantName: tenant.name,
      branding: tenant.branding,
      dashboardUrl: `${this.env.APP_URL.replace(/\/$/, '')}/app/${tenant.slug}`,
      appUrl: this.env.APP_URL,
      verifyBaseUrl: this.env.PUBLIC_VERIFY_BASE_URL ?? this.env.APP_URL,
    });
    try {
      await this.notifications.queueEmail({
        tenantId: tenant.id,
        to: user.email,
        subject,
        text,
        html,
        category: 'welcome',
      });
    } catch (err) {
      // A welcome email must never fail the signup itself.
      this.logger.warn(
        `Could not queue welcome email for ${user.email}: ${(err as Error).message}`,
      );
    }
  }
}

export function summarise(tenant: Tenant, membership: Membership): TenantSummary {
  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    type: tenant.type,
    planId: tenant.planId,
    role: membership.role,
    permissions: permissionsForRole(membership.role),
    branding: tenant.branding,
    settings: tenant.settings,
  };
}
