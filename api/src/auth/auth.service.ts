import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../common/prisma/prisma.service';
import type { AuthenticatedUser } from '../common/decorators';
import type { Env } from '../common/env';

const SESSION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

// Parâmetros recomendados pela OWASP para argon2id.
const ARGON2_OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

// Hash de uma senha qualquer, para o login levar o mesmo tempo mesmo quando o usuário não existe.
let dummyHash: Promise<string> | undefined;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** O app é de um dono só: a conta é criada uma única vez, na primeira abertura. */
  async hasUser(): Promise<boolean> {
    return (await this.prisma.user.count()) > 0;
  }

  async setup(login: string, password: string, userAgent?: string) {
    if (await this.hasUser()) throw new ConflictException('O acesso já foi criado. Entre com seu login.');
    const passwordHash = await argon2.hash(password, ARGON2_OPTIONS);
    const user = await this.prisma.user.create({
      data: { login, passwordHash, settings: { create: {} } },
    });
    return this.createSession(user, userAgent);
  }

  async login(login: string, password: string, userAgent?: string) {
    const user = await this.prisma.user.findUnique({ where: { login } });
    dummyHash ??= argon2.hash('senha-inexistente', ARGON2_OPTIONS);
    const valid = await argon2.verify(user?.passwordHash ?? (await dummyHash), password);
    if (!user || !valid) throw new UnauthorizedException('Login ou senha incorretos.');
    return this.createSession(user, userAgent);
  }

  async logout(sessionId: string) {
    await this.prisma.session.deleteMany({ where: { id: sessionId } });
  }

  async changePassword(user: AuthenticatedUser, currentPassword: string, newPassword: string) {
    const found = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!(await argon2.verify(found.passwordHash, currentPassword))) {
      throw new BadRequestException('Senha atual incorreta.');
    }
    const passwordHash = await argon2.hash(newPassword, ARGON2_OPTIONS);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
      // Derruba as outras sessões (outros aparelhos), mantém a atual.
      this.prisma.session.deleteMany({ where: { userId: user.id, id: { not: user.sessionId } } }),
    ]);
  }

  /** Valida o token do cabeçalho Authorization. Renova a validade no máximo uma vez por dia. */
  async validateToken(token: string): Promise<AuthenticatedUser | null> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: this.hashToken(token) },
      include: { user: true },
    });
    if (!session) return null;

    const now = Date.now();
    if (session.expiresAt.getTime() < now) {
      await this.prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
      return null;
    }
    if (now - session.lastUsedAt.getTime() > DAY_MS) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: { lastUsedAt: new Date(now), expiresAt: new Date(now + SESSION_DAYS * DAY_MS) },
      });
    }
    return { id: session.user.id, login: session.user.login, sessionId: session.id };
  }

  private async createSession(user: { id: string; login: string }, userAgent?: string) {
    const token = randomBytes(32).toString('base64url');
    await this.prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: this.hashToken(token),
        expiresAt: new Date(Date.now() + SESSION_DAYS * DAY_MS),
        userAgent: userAgent?.slice(0, 255),
      },
    });
    return { token, user: { login: user.login } };
  }

  private hashToken(token: string): string {
    const pepper = this.config.get('SESSION_PEPPER', { infer: true });
    return createHash('sha256').update(`${pepper}:${token}`).digest('hex');
  }
}
