import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { PaymentMethod } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import type { CreateGame } from './schemas';
import { toCents, toGame } from './serialize';

const withPlayers = { players: { orderBy: { createdAt: 'asc' } } } as const;

@Injectable()
export class GameService {
  constructor(private readonly prisma: PrismaService) {}

  /** Cria a cobrança do jogo, substituindo a anterior (não há histórico). */
  async create(userId: string, { total, playerIds }: CreateGame) {
    const players = await this.prisma.player.findMany({ where: { userId, id: { in: playerIds } } });
    if (!players.length) throw new BadRequestException('Nenhum jogador válido na cobrança.');

    const game = await this.prisma.$transaction(async (tx) => {
      await tx.game.deleteMany({ where: { userId } });
      return tx.game.create({
        data: {
          userId,
          totalCents: toCents(total),
          players: { create: players.map((p) => ({ playerId: p.id, name: p.name })) },
        },
        include: withPlayers,
      });
    });
    return toGame(game);
  }

  async remove(userId: string) {
    await this.prisma.game.deleteMany({ where: { userId } });
  }

  async updateTotal(userId: string, total: number) {
    const game = await this.findOwned(userId);
    const updated = await this.prisma.game.update({
      where: { id: game.id },
      data: { totalCents: toCents(total) },
      include: withPlayers,
    });
    return toGame(updated);
  }

  async addPlayer(userId: string, playerId: string) {
    const game = await this.findOwned(userId);
    const player = await this.prisma.player.findFirst({ where: { id: playerId, userId } });
    if (!player) throw new NotFoundException('Jogador não encontrado.');
    if (game.players.some((p) => p.playerId === playerId)) {
      throw new ConflictException(`${player.name} já está na cobrança.`);
    }
    await this.prisma.gamePlayer.create({ data: { gameId: game.id, playerId, name: player.name } });
    return this.current(userId);
  }

  async setMethod(userId: string, entryId: string, method: PaymentMethod | null) {
    const game = await this.findOwned(userId);
    this.ensureEntry(game.players, entryId);
    await this.prisma.gamePlayer.update({ where: { id: entryId }, data: { method } });
    return this.current(userId);
  }

  async removePlayer(userId: string, entryId: string) {
    const game = await this.findOwned(userId);
    this.ensureEntry(game.players, entryId);
    await this.prisma.gamePlayer.delete({ where: { id: entryId } });
    return this.current(userId);
  }

  private async current(userId: string) {
    return toGame(await this.findOwned(userId));
  }

  private async findOwned(userId: string) {
    const game = await this.prisma.game.findUnique({ where: { userId }, include: withPlayers });
    if (!game) throw new NotFoundException('Nenhuma cobrança criada.');
    return game;
  }

  private ensureEntry(players: { id: string }[], entryId: string) {
    if (!players.some((p) => p.id === entryId)) throw new NotFoundException('Pessoa não está na cobrança.');
  }
}
