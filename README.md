# Futebol — sorteio & pagamentos

Site para organizar o futebol semanal: cadastro de jogadores com nível (1–6), sorteio de times
equilibrado com 2 goleiros fixos e cobrança do campo dividida entre quem jogou.

| Parte | Tecnologia | Onde roda |
|---|---|---|
| `web/` | HTML + CSS + JS puro (sem build) | Cloudflare Pages |
| `api/` | NestJS 11 + Fastify + Prisma 6 + zod | Render (Docker) |
| Banco | PostgreSQL | Neon (produção) · Docker (local) |

Acesso com login único (conta criada na primeira abertura). A sessão é um token guardado no
navegador e enviado no cabeçalho `Authorization` — sem cookies entre domínios, que o Safari do
iPhone bloqueia. No banco fica só o hash do token (com `SESSION_PEPPER`); a sessão dura 90 dias e
se renova com o uso.

## Rodar localmente

Requisitos: Node 20+ e Docker.

```bash
npm run db                      # Postgres local na porta 5435
cd api
cp .env.example .env            # e troque o SESSION_PEPPER
npm install
npx prisma migrate dev          # cria as tabelas
cd ..
npm run api                     # API em http://localhost:3000/api/v1
npm run web                     # site em http://localhost:5500
```

O site detecta que está em `localhost` e usa a API local (ver `web/js/config.js`).

Teste de ponta a ponta da API (precisa de uma API rodando com banco **vazio**):

```bash
API_URL=http://localhost:3000/api/v1 npm test
```

## Deploy

### 1. Banco no Neon

1. Crie um projeto em [neon.tech](https://neon.tech), de preferência na região **AWS US East (N. Virginia)**
   (a mesma do Render abaixo).
2. Em **Connect**, copie duas strings:
   - **Pooled connection** (host com `-pooler`) → `DATABASE_URL`
   - **Direct connection** (desligue "Connection pooling") → `DIRECT_URL`

### 2. API no Render

1. Suba este repositório no GitHub.
2. No Render: **New → Blueprint** → escolha o repositório. O `render.yaml` cria o serviço
   `futebol-api` (Docker, plano free, health check em `/api/v1/health`).
3. Preencha `DATABASE_URL` e `DIRECT_URL` com as strings do Neon. O `SESSION_PEPPER` é gerado
   automaticamente. Ajuste `CORS_ORIGIN` para o endereço do site (pode ter vários, separados por vírgula).
4. As migrations rodam sozinhas a cada deploy (`prisma migrate deploy` no início do container).
5. Teste: `https://<seu-servico>.onrender.com/api/v1/health` → `{"status":"ok"}`.

> O plano gratuito do Render "dorme" após 15 min sem uso; a primeira abertura depois disso leva
> até ~1 min. O site mostra "Acordando o servidor…" enquanto isso.

### 3. Site no Cloudflare Pages

1. Em `web/js/config.js`, coloque o endereço da API em `PRODUCTION_API`.
2. Cloudflare → **Workers & Pages → Create → Pages**:
   - via Git: build command vazio, **build output directory `web`**;
   - ou **Upload assets** arrastando a pasta `web/`.
3. Abra o site, crie o acesso e, se tiver um backup da versão antiga, use **Jogadores → Conta →
   Importar backup**. Dados antigos que estavam no navegador são oferecidos para importação
   automaticamente no primeiro login.

## Estrutura da API

```
api/src/
  main.ts                 Fastify (limite de 6 MB p/ imagem do QR), CORS, prefixo /api/v1
  app.module.ts           config (env validado com zod), throttler, guard de sessão global
  auth/                   status, setup (1ª conta), login, logout, me, troca de senha
  data/                   estado, jogadores, seleção, sorteio, cobrança, importação
  common/                 Prisma, decorators (@Public, @CurrentUser), pipe de validação zod
api/prisma/schema.prisma  User, Session, Player, Settings, Game, GamePlayer
```

Principais rotas (todas exigem login, exceto `health` e `auth/status|setup|login`):

| Método | Rota | O que faz |
|---|---|---|
| GET | `/state` | tudo que o site precisa ao abrir |
| POST · PATCH · DELETE | `/players[/:id]` | cadastro de jogadores |
| PUT | `/selection` | quem vai jogar e quem está no gol |
| PATCH | `/settings` | nº de times, chave e QR Code do Pix |
| PUT · DELETE | `/draw` | último sorteio |
| POST · PATCH · DELETE | `/game` | cobrança do jogo atual |
| POST · PATCH · DELETE | `/game/players[/:id]` | pessoas da cobrança e forma de pagamento |
| POST | `/import` | substitui tudo por um backup |
