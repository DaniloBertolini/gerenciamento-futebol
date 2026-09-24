import { Body, Controller, Get, Headers, HttpCode, Patch, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { CurrentUser, Public, type AuthenticatedUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { AuthService } from './auth.service';

const credentialsSchema = z.object({
  login: z.string().trim().toLowerCase().min(3, 'Mínimo de 3 caracteres').max(40),
  password: z.string().min(6, 'A senha precisa ter pelo menos 6 caracteres').max(72),
});
type Credentials = z.infer<typeof credentialsSchema>;

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(72),
  newPassword: z.string().min(6, 'A senha precisa ter pelo menos 6 caracteres').max(72),
});

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Diz ao front se deve mostrar "Criar acesso" (primeira vez) ou "Entrar". */
  @Public()
  @Get('status')
  async status() {
    return { hasUser: await this.auth.hasUser() };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('setup')
  setup(@Body(new ZodPipe(credentialsSchema)) body: Credentials, @Headers('user-agent') ua?: string) {
    return this.auth.setup(body.login, body.password, ua);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login')
  login(@Body(new ZodPipe(credentialsSchema)) body: Credentials, @Headers('user-agent') ua?: string) {
    return this.auth.login(body.login, body.password, ua);
  }

  @HttpCode(204)
  @Post('logout')
  async logout(@CurrentUser() user: AuthenticatedUser) {
    await this.auth.logout(user.sessionId);
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return { login: user.login };
  }

  @HttpCode(204)
  @Patch('password')
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodPipe(changePasswordSchema)) body: z.infer<typeof changePasswordSchema>,
  ) {
    await this.auth.changePassword(user, body.currentPassword, body.newPassword);
  }
}
