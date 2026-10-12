import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ENV_CONFIG, type Env } from '../config/config.tokens';
import type { ApiErrorBody } from '@kdc/shared';
import { AppException } from '../common/errors/app.exception';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { Public, RateLimit } from '../common/decorators/permissions.decorator';
import { AuthCtx, type AuthContext } from '../common/decorators/auth-context.decorator';
import { AuthContextGuard, REFRESH_COOKIE, extractIp } from '../common/guards/auth-context.guard';
import { AuthService, type AuthResult } from './auth.service';
import { TokenService } from './token.service';
import { GoogleOAuthService } from './google-oauth.service';
import { acceptInvitationSchema, changePasswordSchema, loginSchema, registerSchema } from './dto';
import type { AcceptInvitationInput, ChangePasswordInput, LoginInput, RegisterInput } from './dto';
import type { AcceptInvitationResult, InvitationDetails } from './auth.service';
import { asHttpRequest } from '../common/http-request';
import { clearAuthCookies, setAuthCookies } from './cookies';

/**
 * Authentication endpoints.
 *
 * The same endpoints serve three kinds of client:
 *  - the browser app, which uses HttpOnly cookies + a CSRF header;
 *  - the installable PWA / mobile, which uses `Authorization: Bearer`;
 *  - the public verify page, which needs none of it.
 * Both cookie and bearer forms are returned on sign-in so a client can choose.
 */
@ApiTags('auth')
@Controller('auth')
@UseGuards(AuthContextGuard)
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
    private readonly google: GoogleOAuthService,
    @Inject(ENV_CONFIG) private readonly env: Env,
  ) {}

  @Public()
  @Post('register')
  @RateLimit(10, 600)
  @ApiOperation({
    summary: 'Create an account, optionally provisioning an organisation at the same time',
  })
  @ApiUnauthorizedResponse({ description: 'Email already registered' })
  async register(
    @Body(new ZodValidationPipe<RegisterInput>(registerSchema, 'Registration')) body: RegisterInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResult & { csrfToken: string }> {
    const result = await this.auth.register(body, this.meta(req));
    const csrfToken = setAuthCookies(res, this.env, result.tokens, true);
    return { ...result, csrfToken };
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @RateLimit(10, 600)
  @ApiOperation({ summary: 'Sign in with email and password' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        email: { type: 'string' },
        password: { type: 'string' },
        remember: { type: 'boolean' },
      },
    },
  })
  async login(
    @Body(new ZodValidationPipe<LoginInput>(loginSchema, 'Login')) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResult & { csrfToken: string }> {
    const input = body;
    const result = await this.auth.login(input, this.meta(req));
    const csrfToken = setAuthCookies(res, this.env, result.tokens, input.remember ?? true);
    return { ...result, csrfToken };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @RateLimit(60, 600)
  @ApiOperation({ summary: 'Rotate the refresh token and obtain a new access token' })
  async refresh(
    @Body() body: { refreshToken?: string } | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{
    accessToken: string;
    expiresAt: string;
    refreshExpiresAt: string;
    csrfToken: string;
  }> {
    const presented = body?.refreshToken ?? readCookie(req, REFRESH_COOKIE);
    if (!presented) throw AppException.unauthenticated('No refresh token presented');
    const { tokens } = await this.tokens.rotate(presented, this.meta(req));
    const csrfToken = setAuthCookies(res, this.env, tokens, true);
    return {
      accessToken: tokens.accessToken,
      expiresAt: tokens.accessExpiresAt.toISOString(),
      refreshExpiresAt: tokens.refreshExpiresAt.toISOString(),
      csrfToken,
    };
  }

  @Public()
  @Get('invite')
  @ApiOperation({ summary: 'Describe a pending invitation (safe: requires the unguessable token)' })
  async describeInvite(@Query('token') token: string | undefined): Promise<InvitationDetails> {
    return this.auth.describeInvitation(String(token ?? '').trim());
  }

  @Public()
  @Post('invite/accept')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Accept an invitation, setting the first password when the account has none',
  })
  async acceptInvite(
    @Body(new ZodValidationPipe<AcceptInvitationInput>(acceptInvitationSchema, 'Invitation'))
    body: AcceptInvitationInput,
    @AuthCtx() ctx: AuthContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AcceptInvitationResult> {
    const result = await this.auth.acceptInvitation(body, ctx.userId ?? null, this.meta(req));
    setAuthCookies(res, this.env, result.tokens, true);
    return result;
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  @ApiOperation({ summary: 'Revoke the current session and clear cookies' })
  async logout(
    @Body() body: { refreshToken?: string } | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    // Logout is deliberately @Public(): a caller with an expired or invalid
    // access token must still be able to clear their session.
    const presented = body?.refreshToken ?? readCookie(req, REFRESH_COOKIE);
    await this.auth.logout(presented, this.meta(req));
    clearAuthCookies(res, this.env);
    return { ok: true };
  }

  @Get('me')
  @ApiOperation({ summary: 'Current account plus every organisation it belongs to' })
  async me(@AuthCtx() ctx: AuthContext): Promise<{ user: unknown; tenants: unknown }> {
    if (!ctx.userId) throw AppException.unauthenticated();
    return this.auth.me(ctx.userId);
  }

  /* ------------------------------------------------------- google oauth */

  @Public()
  @Get('google/status')
  @ApiOperation({ summary: 'Whether Google sign-in is configured on this deployment' })
  googleStatus(): ReturnType<GoogleOAuthService['status']> {
    return this.google.status();
  }

  @Public()
  @Get('google')
  @RateLimit(20, 600)
  @ApiOperation({ summary: 'Start the Google sign-in flow (302 to accounts.google.com)' })
  googleStart(@Query('returnTo') returnTo: string | undefined, @Res() res: Response): void {
    const { url, stateCookie } = this.google.buildAuthorizationUrl(returnTo);
    res.cookie('kdc_oauth_state', stateCookie, {
      httpOnly: true,
      secure: this.env.COOKIE_SECURE,
      sameSite: 'lax',
      maxAge: 600_000,
      path: '/',
    });
    res.redirect(302, url);
  }

  @Public()
  @Get('google/callback')
  @RateLimit(30, 600)
  @ApiOperation({ summary: 'Google OAuth callback - exchanges the code and signs the user in' })
  async googleCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const appUrl = this.env.APP_URL.replace(/\/$/, '');
    const fail = (reason: string): void => {
      res.clearCookie('kdc_oauth_state');
      res.redirect(302, `${appUrl}/login?error=${encodeURIComponent(reason)}`);
    };
    if (error) return fail(`google_${error}`);
    if (!code) return fail('missing_code');

    const verification = this.google.verifyState(state ?? '');
    if (!verification.ok) return fail(verification.reason ?? 'invalid_state');
    const cookieState = readCookie(req, 'kdc_oauth_state');
    if (!cookieState || cookieState !== state) return fail('state_cookie_mismatch');

    try {
      const profile = await this.google.exchangeCode(code);
      const result = await this.auth.signInWithGoogle(profile, this.meta(req));
      setAuthCookies(res, this.env, result.tokens, true);
      res.clearCookie('kdc_oauth_state');
      const target =
        verification.returnTo ?? (result.tenants[0] ? `/app/${result.tenants[0].slug}` : '/app');
      res.redirect(302, `${appUrl}${target.startsWith('/') ? target : '/app'}`);
    } catch (err) {
      const body = (err as { getResponse?: () => ApiErrorBody }).getResponse?.();
      return fail(body?.error ?? 'google_signin_failed');
    }
  }

  @Post('password')
  @HttpCode(200)
  @RateLimit(5, 600)
  @ApiOperation({ summary: 'Change password (revokes all other sessions)' })
  async changePassword(
    @Body(new ZodValidationPipe<ChangePasswordInput>(changePasswordSchema, 'Password change'))
    body: ChangePasswordInput,
    @AuthCtx() ctx: AuthContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    if (!ctx.userId) throw AppException.unauthenticated();
    await this.auth.changePassword(ctx.userId, body, this.meta(req));
    clearAuthCookies(res, this.env);
    return { ok: true };
  }

  @Get('sessions/revoke')
  @ApiOperation({ summary: 'Sign out every device for this account' })
  async revokeAll(
    @AuthCtx() ctx: AuthContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ revoked: number }> {
    if (!ctx.userId) throw AppException.unauthenticated();
    const revoked = await this.tokens.revokeAllForUser(ctx.userId, 'user_requested');
    clearAuthCookies(res, this.env);
    return { revoked };
  }

  private meta(req: Request) {
    return {
      ip: extractIp(asHttpRequest(req), this.env.TRUST_PROXY),
      userAgent: (req.headers['user-agent'] ?? '').slice(0, 512) || null,
      requestId: (req as Request & { requestId?: string }).requestId,
    };
  }
}

function readCookie(req: Request, name: string): string | undefined {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  const value = cookies?.[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
