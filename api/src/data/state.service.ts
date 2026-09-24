import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../common/prisma/prisma.service';
import type { DrawInput, ImportData, Selection, SettingsInput } from './schemas';
import { toCents, toGame, toPlayer } from './serialize';

@Injectable()
export class StateService {
  constructor(private readonly prisma: PrismaService) {}

  /** Tudo que o front precisa numa chamada só (carregamento inicial). */
  async getState(userId: string) {
    const [players, settings, game] = await Promise.all([
      this.prisma.player.findMany({ where: { userId }, orderBy: { name: 'asc' } }),
      this.prisma.settings.upsert({ where: { userId }, create: { userId }, update: {} }),
      this.prisma.game.findUnique({ where: { userId }, include: { players: { orderBy: { createdAt: 'asc' } } } }),
    ]);
    return {
      players: players.map(toPlayer),
      selectedIds: players.filter((p) => p.selected).map((p) => p.id),
      gkTodayIds: players.filter((p) => p.inGoal).map((p) => p.id),
      settings: { numTeams: settings.numTeams, pixKey: settings.pixKey, pixQr: settings.pixQr ?? '' },
      lastDraw: settings.lastDraw ?? null,
      game: toGame(game),
    };
  }

  /** Quem vai jogar e quem está no gol. Só dá para estar no gol quem está marcado. */
  async setSelection(userId: string, { selectedIds, gkTodayIds }: Selection) {
    const selected = new Set(selectedIds);
    const inGoal = gkTodayIds.filter((id) => selected.has(id));
    await this.prisma.$transaction([
      this.prisma.player.updateMany({ where: { userId }, data: { selected: false, inGoal: false } }),
      this.prisma.player.updateMany({ where: { userId, id: { in: [...selected] } }, data: { selected: true } }),
      this.prisma.player.updateMany({ where: { userId, id: { in: inGoal } }, data: { inGoal: true } }),
    ]);
  }

  async updateSettings(userId: string, input: SettingsInput) {
    const data = {
      ...(input.numTeams !== undefined && { numTeams: input.numTeams }),
      ...(input.pixKey !== undefined && { pixKey: input.pixKey }),
      ...(input.pixQr !== undefined && { pixQr: input.pixQr || null }),
    };
    await this.prisma.settings.upsert({ where: { userId }, create: { userId, ...data }, update: data });
  }

  async saveDraw(userId: string, draw: DrawInput) {
    const lastDraw = draw as unknown as Prisma.InputJsonValue;
    await this.prisma.settings.upsert({ where: { userId }, create: { userId, lastDraw }, update: { lastDraw } });
  }

  async clearDraw(userId: string) {
    await this.prisma.settings.upsert({
      where: { userId },
      create: { userId },
      update: { lastDraw: Prisma.DbNull },
    });
  }

  /** Substitui todos os dados pelos de um backup (ex.: o que estava no localStorage). */
  async importBackup(userId: string, data: ImportData) {
    // Ids novos para os jogadores; o mapa traduz as referências do backup.
    const ids = new Map<string, string>(data.players.map((p) => [p.id, randomUUID()]));
    const selected = new Set(data.selectedIds);
    const inGoal = new Set(data.gkTodayIds);
    const mapIds = (list: string[]) => list.map((id) => ids.get(id)).filter((id): id is string => !!id);

    const lastDraw = data.lastDraw && {
      date: data.lastDraw.date,
      goalkeepers: mapIds(data.lastDraw.goalkeepers),
      teams: data.lastDraw.teams.map(mapIds),
    };

    await this.prisma.$transaction(
      async (tx) => {
        await tx.game.deleteMany({ where: { userId } });
        await tx.player.deleteMany({ where: { userId } });
        await tx.player.createMany({
          data: data.players.map((p) => ({
            id: ids.get(p.id)!,
            userId,
            name: p.name,
            level: p.level,
            selected: selected.has(p.id),
            inGoal: selected.has(p.id) && inGoal.has(p.id),
          })),
        });

        const settings = {
          numTeams: data.settings.numTeams ?? 2,
          pixKey: data.settings.pixKey ?? '',
          pixQr: data.settings.pixQr || null,
          lastDraw: lastDraw ? (lastDraw as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        };
        await tx.settings.upsert({ where: { userId }, create: { userId, ...settings }, update: settings });

        if (data.game) {
          await tx.game.create({
            data: {
              userId,
              totalCents: toCents(data.game.total),
              ...(data.game.createdAt && { createdAt: new Date(data.game.createdAt) }),
              players: {
                create: data.game.players.map((p) => ({
                  playerId: ids.get(p.id) ?? null,
                  name: p.name,
                  method: p.method,
                })),
              },
            },
          });
        }
      },
      { timeout: 20_000 },
    );
    return this.getState(userId);
  }
}
