import { z } from 'zod';

export const METHODS = ['dinheiro', 'pix', 'cartao', 'pago'] as const;

const id = z.string().min(1).max(64);
const name = z
  .string()
  .trim()
  .min(1, 'Informe o nome')
  .max(40)
  .transform((s) => s.replace(/\s+/g, ' '));
const level = z.number().int().min(1).max(6);
// Valor em reais (ex.: 150 ou 92.5). Guardamos em centavos.
const money = z.number().positive('O valor precisa ser maior que zero').max(100_000);

export const createPlayerSchema = z.object({ name, level });
export const updatePlayerSchema = z.object({ name: name.optional(), level: level.optional() });

export const selectionSchema = z.object({
  selectedIds: z.array(id).max(500),
  gkTodayIds: z.array(id).max(500),
});

export const settingsSchema = z.object({
  numTeams: z.number().int().min(2).max(10).optional(),
  pixKey: z.string().trim().max(80).optional(),
  pixQr: z
    .string()
    .max(4_000_000, 'Imagem grande demais')
    .regex(/^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,/, 'Imagem inválida')
    .nullable()
    .optional(),
});

export const drawSchema = z.object({
  date: z.string().datetime(),
  goalkeepers: z.array(id).max(20),
  teams: z.array(z.array(id).max(100)).min(2).max(10),
});

export const createGameSchema = z.object({
  total: money,
  playerIds: z.array(id).min(1, 'Marque quem jogou').max(200),
});
export const updateGameSchema = z.object({ total: money });
export const addGamePlayerSchema = z.object({ playerId: id });
export const setMethodSchema = z.object({ method: z.enum(METHODS).nullable() });

/** Backup exportado pelo site (formato do antigo localStorage). */
export const importSchema = z.object({
  players: z.array(z.object({ id, name, level })).max(1000),
  selectedIds: z.array(id).default([]),
  gkTodayIds: z.array(id).default([]),
  settings: z
    .object({
      numTeams: z.number().int().min(2).max(10).default(2),
      pixKey: z.string().max(80).default(''),
      pixQr: z.string().max(4_000_000).nullable().default(null),
    })
    .partial()
    .default({}),
  lastDraw: drawSchema.nullable().default(null),
  game: z
    .object({
      createdAt: z.string().datetime().optional(),
      total: z.number().min(0).max(100_000),
      players: z.array(z.object({ id, name: z.string().max(40), method: z.enum(METHODS).nullable() })).max(200),
    })
    .nullable()
    .default(null),
});

export type CreatePlayer = z.infer<typeof createPlayerSchema>;
export type UpdatePlayer = z.infer<typeof updatePlayerSchema>;
export type Selection = z.infer<typeof selectionSchema>;
export type SettingsInput = z.infer<typeof settingsSchema>;
export type DrawInput = z.infer<typeof drawSchema>;
export type CreateGame = z.infer<typeof createGameSchema>;
export type ImportData = z.infer<typeof importSchema>;
