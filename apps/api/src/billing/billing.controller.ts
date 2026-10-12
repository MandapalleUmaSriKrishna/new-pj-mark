import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { PlanId } from '@kdc/shared';
import { PLANS } from '@kdc/shared';
import { AppException } from '../common/errors/app.exception';
import { AuthCtx, TenantId, type AuthContext } from '../common/decorators/auth-context.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { BillingService, type BillingSummary } from './billing.service';

/** Plans, usage and subscription state. */
@ApiTags('billing')
@Controller('tenants/:tenantId/billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('plans')
  @RequirePermissions('billing:read')
  @ApiOperation({ summary: 'Plan catalogue with entitlements' })
  plans(): { items: ReturnType<BillingService['plans']> } {
    return { items: this.billing.plans() };
  }

  @Get()
  @RequirePermissions('billing:read')
  @ApiOperation({ summary: 'Current plan, usage and available upgrades' })
  async summary(@TenantId() tenantId: string): Promise<BillingSummary> {
    return this.billing.summary(tenantId);
  }

  @Post('plan')
  @HttpCode(200)
  @RequirePermissions('billing:manage')
  @ApiOperation({ summary: 'Change plan (manual mode unless a payment provider is configured)' })
  async changePlan(
    @TenantId() tenantId: string,
    @Body() body: { planId?: string },
    @AuthCtx() ctx: AuthContext,
  ) {
    if (!ctx.userId) throw AppException.unauthenticated();
    const planId = String(body?.planId ?? '') as PlanId;
    if (!(planId in PLANS)) throw AppException.validationFailed(`Unknown plan "${planId}"`);
    return this.billing.changePlan(tenantId, planId, ctx.userId);
  }

  @Post('cancel')
  @HttpCode(200)
  @RequirePermissions('billing:manage')
  @ApiOperation({ summary: 'Cancel at the end of the current period' })
  async cancel(@TenantId() tenantId: string, @AuthCtx() ctx: AuthContext) {
    if (!ctx.userId) throw AppException.unauthenticated();
    return this.billing.cancelAtPeriodEnd(tenantId, ctx.userId);
  }

  @Get('invoices')
  @RequirePermissions('billing:read')
  @ApiOperation({ summary: 'Invoices from the payment provider' })
  async invoices(@TenantId() tenantId: string) {
    return this.billing.invoices(tenantId);
  }
}
