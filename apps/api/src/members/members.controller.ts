import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppException } from '../common/errors/app.exception';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AuthCtx, TenantId, type AuthContext } from '../common/decorators/auth-context.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import {
  inviteMemberSchema,
  updateMemberRoleSchema,
  type InviteMemberInput,
  type UpdateMemberRoleInput,
} from '../auth/dto';
import { MembersService, type InviteResult, type MemberRow } from './members.service';

/** Team management. */
@ApiTags('members')
@Controller('tenants/:tenantId/members')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  @RequirePermissions('member:read')
  @ApiOperation({ summary: 'List team members with their effective permissions' })
  async list(@TenantId() tenantId: string): Promise<{ items: MemberRow[] }> {
    return { items: await this.members.list(tenantId) };
  }

  @Get('pending')
  @RequirePermissions('member:read')
  @ApiOperation({ summary: 'List invitations that have not been accepted yet' })
  async pending(@TenantId() tenantId: string) {
    return { items: await this.members.pendingInvites(tenantId) };
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions('member:invite')
  @ApiOperation({ summary: 'Invite a team member' })
  async invite(
    @TenantId() tenantId: string,
    @Body(new ZodValidationPipe<InviteMemberInput>(inviteMemberSchema, 'Invitation'))
    body: InviteMemberInput,
    @AuthCtx() ctx: AuthContext,
  ): Promise<InviteResult> {
    if (!ctx.userId || !ctx.role) throw AppException.unauthenticated();
    return this.members.invite(tenantId, body, {
      id: ctx.userId,
      name: ctx.name ?? 'An administrator',
      role: ctx.role,
    });
  }

  @Post(':membershipId/resend')
  @HttpCode(200)
  @RequirePermissions('member:invite')
  @ApiOperation({ summary: 'Re-send an outstanding invitation with a fresh token' })
  async resend(
    @TenantId() tenantId: string,
    @Param('membershipId') membershipId: string,
    @AuthCtx() ctx: AuthContext,
  ) {
    if (!ctx.userId || !ctx.role) throw AppException.unauthenticated();
    return this.members.resendInvite(tenantId, membershipId, {
      id: ctx.userId,
      name: ctx.name ?? 'An administrator',
      role: ctx.role,
    });
  }

  @Patch(':membershipId')
  @RequirePermissions('member:update')
  @ApiOperation({ summary: 'Change a member role' })
  async changeRole(
    @TenantId() tenantId: string,
    @Param('membershipId') membershipId: string,
    @Body(new ZodValidationPipe<UpdateMemberRoleInput>(updateMemberRoleSchema, 'Role'))
    body: UpdateMemberRoleInput,
    @AuthCtx() ctx: AuthContext,
  ) {
    if (!ctx.userId || !ctx.role) throw AppException.unauthenticated();
    const input = body;
    return this.members.changeRole(tenantId, membershipId, input.role, {
      id: ctx.userId,
      name: ctx.name ?? '',
      role: ctx.role,
    });
  }

  @Delete(':membershipId')
  @RequirePermissions('member:remove')
  @ApiOperation({ summary: 'Remove a member from the organisation' })
  async remove(
    @TenantId() tenantId: string,
    @Param('membershipId') membershipId: string,
    @AuthCtx() ctx: AuthContext,
  ) {
    if (!ctx.userId || !ctx.role) throw AppException.unauthenticated();
    return this.members.remove(tenantId, membershipId, {
      id: ctx.userId,
      name: ctx.name ?? '',
      role: ctx.role,
    });
  }
}
