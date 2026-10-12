import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { ApiKey } from '@kdc/shared';
import { AppException } from '../common/errors/app.exception';
import { AuthCtx, TenantId, type AuthContext } from '../common/decorators/auth-context.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { API_KEY_SCOPES, ApiKeysService } from './api-keys.service';

type RedactedKey = Omit<ApiKey, 'secretHash'>;

/** Programmatic access credentials. */
@ApiTags('api-keys')
@Controller('tenants/:tenantId/api-keys')
export class ApiKeysController {
  constructor(private readonly keys: ApiKeysService) {}

  @Get('scopes')
  @RequirePermissions('apikey:manage')
  @ApiOperation({ summary: 'Available scopes' })
  scopes(): { scopes: readonly string[] } {
    return { scopes: API_KEY_SCOPES };
  }

  @Get()
  @RequirePermissions('apikey:manage')
  @ApiOperation({ summary: 'List keys (hashes are never returned)' })
  async list(@TenantId() tenantId: string): Promise<{ items: RedactedKey[] }> {
    return { items: await this.keys.list(tenantId) };
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions('apikey:manage')
  @ApiOperation({ summary: 'Create a key; the plaintext is shown exactly once' })
  async create(
    @TenantId() tenantId: string,
    @Body() body: { name?: string; scopes?: string[]; expiresAt?: string | null },
    @AuthCtx() ctx: AuthContext,
  ) {
    if (!ctx.userId) throw AppException.unauthenticated();
    const result = await this.keys.create(
      tenantId,
      {
        name: String(body?.name ?? ''),
        scopes: Array.isArray(body?.scopes) ? body.scopes.map(String) : [],
        expiresAt: body?.expiresAt ? new Date(body.expiresAt) : null,
      },
      ctx.userId,
    );
    return {
      key: result.key,
      plaintext: result.plaintext,
      warning: 'Store this secret now. It is hashed before storage and cannot be shown again.',
      usage:
        'Send it as "Authorization: Bearer <key>" or "X-API-Key: <key>" on routes marked as key-accessible.',
    };
  }

  @Post(':keyId/rotate')
  @HttpCode(201)
  @RequirePermissions('apikey:manage')
  @ApiOperation({ summary: 'Revoke a key and issue a replacement with the same scopes' })
  async rotate(
    @TenantId() tenantId: string,
    @Param('keyId') keyId: string,
    @AuthCtx() ctx: AuthContext,
  ) {
    if (!ctx.userId) throw AppException.unauthenticated();
    const result = await this.keys.rotate(tenantId, keyId, ctx.userId);
    return {
      key: result.key,
      plaintext: result.plaintext,
      warning: 'The previous key was revoked immediately.',
    };
  }

  @Delete(':keyId')
  @RequirePermissions('apikey:manage')
  @ApiOperation({ summary: 'Revoke a key' })
  async revoke(
    @TenantId() tenantId: string,
    @Param('keyId') keyId: string,
    @AuthCtx() ctx: AuthContext,
  ) {
    if (!ctx.userId) throw AppException.unauthenticated();
    return this.keys.revoke(tenantId, keyId, ctx.userId);
  }
}
