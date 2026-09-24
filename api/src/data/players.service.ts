import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { normalizeName } from './normalize';
import type { CreatePlayer, UpdatePlayer } from './schemas';
import { toPlayer } from './serialize';

@Injectable()
export class PlayersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, input: CreatePlayer) {
    await this.ensureUniqueName(userId, input.name);
    const player = await this.prisma.player.create({ data: { userId, ...input } });
    return toPlayer(player);
  }

  async update(userId: string, id: string, input: UpdatePlayer) {
    await this.findOwned(userId, id);
    if (input.name) await this.ensureUniqueName(userId, input.name, id);
    const player = await this.prisma.player.update({ where: { id }, data: input });
    return toPlayer(player);
  }

  /** A cobrança mantém o nome (playerId vira null); o último sorteio só ignora o id. */
  async remove(userId: string, id: string) {
    await this.findOwned(userId, id);
    await this.prisma.player.delete({ where: { id } });
  }

  private async findOwned(userId: string, id: string) {
    const player = await this.prisma.player.findFirst({ where: { id, userId } });
    if (!player) throw new NotFoundException('Jogador não encontrado.');
    return player;
  }

  private async ensureUniqueName(userId: string, name: string, exceptId?: string) {
    const target = normalizeName(name);
    const players = await this.prisma.player.findMany({ where: { userId }, select: { id: true, name: true } });
    const duplicate = players.find((p) => p.id !== exceptId && normalizeName(p.name) === target);
    if (duplicate) throw new ConflictException(`Já existe um jogador chamado "${duplicate.name}".`);
  }
}
