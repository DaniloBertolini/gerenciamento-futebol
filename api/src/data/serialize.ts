import type { Game, GamePlayer, Player } from '@prisma/client';

// Formatos de resposta: espelham o estado que o front já usava no localStorage.

export const toPlayer = (p: Player) => ({ id: p.id, name: p.name, level: p.level });

export type GameWithPlayers = Game & { players: GamePlayer[] };

export const toGame = (g: GameWithPlayers | null) =>
  g && {
    createdAt: g.createdAt.toISOString(),
    total: g.totalCents / 100,
    players: g.players.map((p) => ({ id: p.id, playerId: p.playerId, name: p.name, method: p.method })),
  };

export const toCents = (reais: number) => Math.round(reais * 100);
