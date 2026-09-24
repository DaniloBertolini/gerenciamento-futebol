// Teste de ponta a ponta contra uma API rodando com banco VAZIO.
//   docker compose up -d && npm run build && npm run start:prod   (em outro terminal)
//   API_URL=http://localhost:3000/api/v1 npm run test:e2e
import assert from 'node:assert/strict';
import { test } from 'node:test';

const API = process.env.API_URL ?? 'http://localhost:3000/api/v1';
let token;

async function call(method, path, body, auth = token) {
  const res = await fetch(API + path, {
    method,
    headers: {
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
      ...(auth && { Authorization: `Bearer ${auth}` }),
      Origin: 'http://localhost:5500',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
}

test('health e CORS', async () => {
  const r = await call('GET', '/health');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { status: 'ok' });
  assert.equal(r.headers.get('access-control-allow-origin'), 'http://localhost:5500');
});

test('conta: criar acesso só uma vez, login e sessão', async () => {
  assert.deepEqual((await call('GET', '/auth/status')).body, { hasUser: false });
  assert.equal((await call('GET', '/state')).status, 401);

  const invalid = await call('POST', '/auth/setup', { login: 'da', password: '123' });
  assert.equal(invalid.status, 422);
  assert.ok(invalid.body.errors.login && invalid.body.errors.password);

  const setup = await call('POST', '/auth/setup', { login: 'Danilo', password: 'segredo123' });
  assert.equal(setup.status, 201);
  assert.equal(setup.body.user.login, 'danilo');
  assert.ok(setup.body.token.length > 30);

  assert.equal((await call('POST', '/auth/setup', { login: 'outro', password: 'segredo123' })).status, 409);
  assert.deepEqual((await call('GET', '/auth/status')).body, { hasUser: true });

  assert.equal((await call('POST', '/auth/login', { login: 'danilo', password: 'errada1' })).status, 401);
  const login = await call('POST', '/auth/login', { login: 'DANILO', password: 'segredo123' });
  assert.equal(login.status, 200);
  token = login.body.token;
  assert.equal((await call('GET', '/auth/me')).body.login, 'danilo');
  assert.equal((await call('GET', '/state', undefined, 'token-falso')).status, 401);
});

test('jogadores, seleção, sorteio e cobrança', async () => {
  const add = (name, level) => call('POST', '/players', { name, level });
  const canuto = (await add('Canuto', 5)).body;
  const ale = (await add('  Alexandre   Silva ', 4)).body;
  const dan = (await add('Danilo', 4)).body;
  assert.equal(ale.name, 'Alexandre Silva');

  const dup = await add('danilo', 3);
  assert.equal(dup.status, 409);
  assert.match(dup.body.message, /Danilo/);
  assert.equal((await add('X', 9)).status, 422);

  const edited = await call('PATCH', `/players/${dan.id}`, { level: 6 });
  assert.equal(edited.body.level, 6);

  // Seleção: quem não está marcado não pode ficar no gol.
  await call('PUT', '/selection', { selectedIds: [canuto.id, ale.id, dan.id], gkTodayIds: [canuto.id, 'fantasma'] });
  let state = (await call('GET', '/state')).body;
  assert.equal(state.selectedIds.length, 3);
  assert.deepEqual(state.gkTodayIds, [canuto.id]);

  await call('PATCH', '/settings', { numTeams: 3, pixKey: 'danilo@pix.com', pixQr: 'data:image/png;base64,iVBOR' });
  assert.equal((await call('PATCH', '/settings', { pixQr: 'javascript:alert(1)' })).status, 422);

  const draw = { date: new Date().toISOString(), goalkeepers: [canuto.id], teams: [[ale.id], [dan.id]] };
  assert.equal((await call('PUT', '/draw', draw)).status, 204);
  state = (await call('GET', '/state')).body;
  assert.deepEqual(state.lastDraw, draw);
  assert.equal(state.settings.numTeams, 3);
  assert.equal(state.settings.pixKey, 'danilo@pix.com');
  assert.equal((await call('DELETE', '/draw')).status, 204);
  assert.equal((await call('GET', '/state')).body.lastDraw, null);

  // Cobrança
  let game = (await call('POST', '/game', { total: 150, playerIds: [canuto.id, ale.id, dan.id] })).body;
  assert.equal(game.total, 150);
  assert.equal(game.players.length, 3);
  const entry = game.players.find((p) => p.playerId === dan.id);
  game = (await call('PATCH', `/game/players/${entry.id}`, { method: 'pix' })).body;
  assert.equal(game.players.find((p) => p.id === entry.id).method, 'pix');
  assert.equal((await call('PATCH', `/game/players/${entry.id}`, { method: 'boleto' })).status, 422);
  game = (await call('PATCH', '/game', { total: 92.5 })).body;
  assert.equal(game.total, 92.5);

  const bia = (await add('Bia', 2)).body;
  game = (await call('POST', '/game/players', { playerId: bia.id })).body;
  assert.equal(game.players.length, 4);
  assert.equal((await call('POST', '/game/players', { playerId: bia.id })).status, 409);
  const biaEntry = game.players.find((p) => p.playerId === bia.id);
  game = (await call('DELETE', `/game/players/${biaEntry.id}`)).body;
  assert.equal(game.players.length, 3);

  // Excluir jogador do cadastro mantém o nome na cobrança.
  assert.equal((await call('DELETE', `/players/${ale.id}`)).status, 204);
  state = (await call('GET', '/state')).body;
  const kept = state.game.players.find((p) => p.name === 'Alexandre Silva');
  assert.equal(kept.playerId, null);
  assert.equal(state.players.length, 3);

  assert.equal((await call('DELETE', '/game')).status, 204);
  assert.equal((await call('GET', '/state')).body.game, null);
});

test('importar backup do localStorage', async () => {
  const backup = {
    players: [
      { id: 'a1', name: 'Canuto', level: 5 },
      { id: 'b2', name: 'Jonnes', level: 5 },
      { id: 'c3', name: 'Pedro', level: 6 },
    ],
    selectedIds: ['a1', 'c3'],
    gkTodayIds: ['a1', 'b2'],
    settings: { numTeams: 2, pixKey: 'chave', pixQr: '' },
    lastDraw: { date: new Date().toISOString(), goalkeepers: ['a1'], teams: [['c3'], ['sumiu']] },
    game: { createdAt: new Date().toISOString(), total: 150, players: [{ id: 'c3', name: 'Pedro', method: 'dinheiro' }, { id: 'zz', name: 'Antigo', method: null }] },
  };
  const r = await call('POST', '/import', backup);
  assert.equal(r.status, 200);
  const s = r.body;
  assert.deepEqual(s.players.map((p) => p.name), ['Canuto', 'Jonnes', 'Pedro']);
  const idOf = (n) => s.players.find((p) => p.name === n).id;
  assert.deepEqual(s.selectedIds.sort(), [idOf('Canuto'), idOf('Pedro')].sort());
  assert.deepEqual(s.gkTodayIds, [idOf('Canuto')]); // Jonnes não estava marcado
  assert.deepEqual(s.lastDraw.teams, [[idOf('Pedro')], []]);
  assert.equal(s.game.players.find((p) => p.name === 'Pedro').playerId, idOf('Pedro'));
  assert.equal(s.game.players.find((p) => p.name === 'Antigo').playerId, null);
  assert.equal(s.settings.pixKey, 'chave');
});

test('trocar senha e sair', async () => {
  assert.equal((await call('PATCH', '/auth/password', { currentPassword: 'errada', newPassword: 'nova12345' })).status, 400);
  assert.equal((await call('PATCH', '/auth/password', { currentPassword: 'segredo123', newPassword: 'nova12345' })).status, 204);
  assert.equal((await call('POST', '/auth/login', { login: 'danilo', password: 'segredo123' })).status, 401);
  assert.equal((await call('POST', '/auth/logout')).status, 204);
  assert.equal((await call('GET', '/state')).status, 401);
});
