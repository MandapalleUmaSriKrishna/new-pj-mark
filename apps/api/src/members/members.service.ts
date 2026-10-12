import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Membership, Role, Tenant, User } from '@kdc/shared';
import { canManageRole, permissionsForRole, type Permission } from '@kdc/shared';
import { ENV_CONFIG, type Env } from '../config/config.tokens';
import { smtpConfigured } from '../config/env';
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
import { inviteEmail } from '../notifications/email-templates';

const INVITE_TTL_DAYS = 14;
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface MemberActor {
  id: string;
  name: string;
  role: Role;
}

export interface MemberRow {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  role: Role;
  status: Membership['status'];
  permissions: Permission[];
  joinedAt: string | null;
  invitedBy: string | null;
  inviteExpiresAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface InviteResult {
  membershipId: string;
  email: string;
  role: Role;
  queued: boolean;
  /** Present only when no SMTP credentials are configured, so an admin can copy it manually. */
  inviteUrl: string | null;
}

/**
 * Teams.
 *
 * A user belongs to an organisation through a Membership that carries the role,
 * so the same person can be an owner in one tenant and a viewer in another.
 * Removing or demoting the last owner is refused: that state could only be
 * recovered with direct database access.
 */
@Injectable()
export class MembersService {
  private readonly logger = new Logger(MembersService.name);
  private readonly memberships: Repository<Membership>;
  private readonly users: Repository<User>;

  constructor(
    @Inject(DATA_STORE) store: DataStore,
    @Inject(ENV_CONFIG) private readonly env: Env,
    private readonly crypto: CryptoService,
    private readonly tenants: TenantsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {
    this.memberships = store.repository<Membership>('memberships');
    this.users = store.repository<User>('users');
  }

  async list(tenantId: string): Promise<MemberRow[]> {
    const rows = await this.memberships.find({ tenantId }, { sort: { createdAt: 1 } });
    const out: MemberRow[] = [];
    for (const membership of rows) {
      const user = await this.users.findById(membership.userId);
      if (!user) continue;
      out.push({
        membershipId: membership.id,
        userId: user.id,
        name: user.name,
        email: user.email,
        role: membership.role,
        status: membership.status,
        permissions: permissionsForRole(membership.role),
        joinedAt: membership.joinedAt ? new Date(membership.joinedAt).toISOString() : null,
        invitedBy: membership.invitedBy ?? null,
        inviteExpiresAt: membership.inviteExpiresAt
          ? new Date(membership.inviteExpiresAt).toISOString()
          : null,
        lastLoginAt: user.lastLoginAt ? new Date(user.lastLoginAt).toISOString() : null,
        createdAt: new Date(membership.createdAt).toISOString(),
      });
    }
    return out;
  }

  async invite(
    tenantId: string,
    input: { email: string; name?: string; role: Role },
    actor: MemberActor,
  ): Promise<InviteResult> {
    await this.tenants.assertHeadroom(tenantId, 'members');
    if (!canManageRole(actor.role, input.role)) {
      throw AppException.permissionDenied(`A ${actor.role} cannot invite a ${input.role}`);
    }
    const email = input.email.trim().toLowerCase();
    if (!EMAIL_RX.test(email))
      throw AppException.validationFailed('A valid email address is required');

    const tenant = await this.tenants.findById(tenantId);
    const existingUser = await this.users.findOne({ email });
    const existingMembership = existingUser
      ? await this.memberships.findOne({ tenantId, userId: existingUser.id })
      : null;
    if (existingMembership && existingMembership.status === 'active') {
      throw AppException.conflict('That person is already a member of this organisation');
    }

    const now = new Date();
    const inviteExpiresAt = new Date(now.getTime() + INVITE_TTL_DAYS * 86_400_000);
    const token = this.crypto.randomToken(32);

    let userId = existingUser?.id;
    if (!userId) {
      const user: User = {
        id: newId(),
        email,
        emailVerified: false,
        name:
          input.name?.trim() ||
          email
            .split('@')[0]!
            .replace(/[._-]+/g, ' ')
            .replace(/\b\w/g, (c) => c.toUpperCase()),
        passwordHash: null,
        googleId: null,
        avatarUrl: null,
        locale: 'en',
        status: 'invited',
        lastLoginAt: null,
        mfaEnabled: false,
        refreshTokenFamily: null,
        createdAt: now,
        updatedAt: now,
      };
      try {
        await this.users.insert(user);
      } catch (err) {
        if (err instanceof DuplicateKeyError)
          throw AppException.conflict('That email address is already registered');
        throw err;
      }
      userId = user.id;
    }

    const invitee = (await this.users.findById(userId)) as User;
    const inviteUrl = `${this.env.APP_URL.replace(/\/$/, '')}/invite?token=${token}`;

    let membershipId: string;
    if (existingMembership) {
      const updated = await this.memberships.updateById(existingMembership.id, {
        role: input.role,
        status: 'invited',
        invitedBy: actor.id,
        inviteToken: token,
        inviteExpiresAt,
        joinedAt: null,
      });
      if (!updated) throw AppException.notFound('Member');
      membershipId = updated.id;
    } else {
      const membership: Membership = {
        id: newId(),
        tenantId,
        userId,
        role: input.role,
        status: 'invited',
        invitedBy: actor.id,
        inviteToken: token,
        inviteExpiresAt,
        joinedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      await this.memberships.insert(membership);
      membershipId = membership.id;
    }

    const { subject, text, html } = inviteEmail({
      tenantName: tenant.name,
      branding: tenant.branding,
      inviterName: actor.name,
      inviteeName: invitee.name,
      role: input.role,
      inviteUrl,
      appUrl: this.env.APP_URL,
      verifyBaseUrl: this.env.PUBLIC_VERIFY_BASE_URL ?? this.env.APP_URL,
    });
    await this.notifications.queueEmail({
      tenantId,
      to: email,
      subject,
      text,
      html,
      category: 'invite',
    });

    await this.audit.record({
      tenantId,
      actorId: actor.id,
      actorRole: actor.role,
      action: 'member.invited',
      entityType: 'membership',
      entityId: membershipId,
      payload: { email, role: input.role, expiresAt: inviteExpiresAt.toISOString() },
      severity: 'warning',
    });
    this.logger.log(`Invited ${email} as ${input.role} to tenant ${tenantId}`);
    // Honest degradation: with no SMTP credentials the mail driver only captures
    // the message, so the URL is handed back for the admin to forward manually.
    return {
      membershipId,
      email,
      role: input.role,
      queued: true,
      inviteUrl: smtpConfigured(this.env) ? null : inviteUrl,
    };
  }

  async changeRole(
    tenantId: string,
    membershipId: string,
    role: Role,
    actor: MemberActor,
  ): Promise<Membership> {
    const membership = await this.memberships.findById(membershipId);
    if (!membership || membership.tenantId !== tenantId) throw AppException.notFound('Member');
    if (!canManageRole(actor.role, role) || !canManageRole(actor.role, membership.role)) {
      throw AppException.permissionDenied(`A ${actor.role} cannot change this member's role`);
    }
    if (membership.role === 'owner' && role !== 'owner') {
      const owners = await this.memberships.count({ tenantId, role: 'owner', status: 'active' });
      if (owners <= 1)
        throw AppException.conflict(
          'Transfer ownership to another member before demoting the last owner',
        );
    }
    const updated = await this.memberships.updateById(membershipId, { role });
    if (!updated) throw AppException.notFound('Member');
    await this.audit.record({
      tenantId,
      actorId: actor.id,
      actorRole: actor.role,
      action: 'member.role_changed',
      entityType: 'membership',
      entityId: membershipId,
      payload: { from: membership.role, to: role, userId: membership.userId },
      severity: 'warning',
    });
    return updated;
  }

  async remove(tenantId: string, membershipId: string, actor: MemberActor): Promise<{ ok: true }> {
    const membership = await this.memberships.findById(membershipId);
    if (!membership || membership.tenantId !== tenantId) throw AppException.notFound('Member');
    if (!canManageRole(actor.role, membership.role)) {
      throw AppException.permissionDenied(`A ${actor.role} cannot remove a ${membership.role}`);
    }
    if (membership.role === 'owner') {
      const owners = await this.memberships.count({ tenantId, role: 'owner', status: 'active' });
      if (owners <= 1) throw AppException.conflict('An organisation must keep at least one owner');
    }
    await this.memberships.deleteById(membershipId);
    await this.audit.record({
      tenantId,
      actorId: actor.id,
      actorRole: actor.role,
      action: 'member.removed',
      entityType: 'membership',
      entityId: membershipId,
      payload: { userId: membership.userId, role: membership.role },
      severity: 'critical',
    });
    return { ok: true };
  }

  /** Redeems an invite token. The caller must already be authenticated. */
  async acceptInvite(
    token: string,
    userId: string,
  ): Promise<{ tenantId: string; tenantName: string; role: Role }> {
    const membership = await this.memberships.findOne({ inviteToken: token });
    if (!membership) throw AppException.notFound('Invitation');
    if (membership.status !== 'invited')
      throw AppException.conflict('That invitation has already been used');
    if (membership.inviteExpiresAt && new Date(membership.inviteExpiresAt).getTime() < Date.now()) {
      throw AppException.conflict(
        'That invitation has expired; ask an administrator to send a new one',
      );
    }
    const invitee = await this.users.findById(membership.userId);
    if (!invitee) throw AppException.notFound('Invited account');
    if (invitee.id !== userId) {
      // The invitation belongs to whoever it was emailed to.
      throw AppException.forbidden(
        `This invitation was issued to ${invitee.email}; sign in with that account to accept it`,
      );
    }

    const updated = await this.memberships.updateById(membership.id, {
      status: 'active',
      inviteToken: null,
      inviteExpiresAt: null,
      joinedAt: new Date(),
    });
    if (!updated) throw AppException.notFound('Invitation');
    await this.users.updateById(userId, { status: 'active', emailVerified: true });

    const tenant: Tenant = await this.tenants.findById(membership.tenantId);
    await this.audit.record({
      tenantId: membership.tenantId,
      actorId: userId,
      actorRole: updated.role,
      action: 'member.joined',
      entityType: 'membership',
      entityId: membership.id,
      payload: { role: updated.role, email: invitee.email },
    });
    return { tenantId: membership.tenantId, tenantName: tenant.name, role: updated.role };
  }

  async resendInvite(
    tenantId: string,
    membershipId: string,
    actor: MemberActor,
  ): Promise<InviteResult> {
    const membership = await this.memberships.findById(membershipId);
    if (!membership || membership.tenantId !== tenantId) throw AppException.notFound('Member');
    if (membership.status !== 'invited')
      throw AppException.conflict('That member has already accepted their invitation');
    const invitee = await this.users.findById(membership.userId);
    if (!invitee) throw AppException.notFound('Invited account');
    const tenant = await this.tenants.findById(tenantId);

    const token = this.crypto.randomToken(32);
    const inviteExpiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000);
    await this.memberships.updateById(membershipId, { inviteToken: token, inviteExpiresAt });

    const inviteUrl = `${this.env.APP_URL.replace(/\/$/, '')}/invite?token=${token}`;
    const { subject, text, html } = inviteEmail({
      tenantName: tenant.name,
      branding: tenant.branding,
      inviterName: actor.name,
      inviteeName: invitee.name,
      role: membership.role,
      inviteUrl,
      message: 'This is a reminder about your earlier invitation.',
      appUrl: this.env.APP_URL,
      verifyBaseUrl: this.env.PUBLIC_VERIFY_BASE_URL ?? this.env.APP_URL,
    });
    await this.notifications.queueEmail({
      tenantId,
      to: invitee.email,
      subject,
      text,
      html,
      category: 'invite',
    });
    await this.audit.record({
      tenantId,
      actorId: actor.id,
      actorRole: actor.role,
      action: 'member.invited',
      entityType: 'membership',
      entityId: membershipId,
      payload: { email: invitee.email, resent: true },
    });
    return {
      membershipId,
      email: invitee.email,
      role: membership.role,
      queued: true,
      inviteUrl: smtpConfigured(this.env) ? null : inviteUrl,
    };
  }

  async pendingInvites(
    tenantId: string,
  ): Promise<{ membershipId: string; email: string; role: Role; expiresAt: string }[]> {
    const rows = await this.memberships.find(
      { tenantId, status: 'invited' },
      { sort: { createdAt: -1 } },
    );
    const out: { membershipId: string; email: string; role: Role; expiresAt: string }[] = [];
    for (const row of rows) {
      const user = await this.users.findById(row.userId);
      out.push({
        membershipId: row.id,
        email: user?.email ?? '(unknown)',
        role: row.role,
        expiresAt: row.inviteExpiresAt ? new Date(row.inviteExpiresAt).toISOString() : '',
      });
    }
    return out;
  }
}
