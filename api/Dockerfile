# API do Futebol — imagem usada pelo Render.
#   docker build -t futebol-api ./api
FROM node:22-alpine AS build
# Prisma precisa do OpenSSL para escolher o engine certo no Alpine.
RUN apk add --no-cache openssl
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY prisma ./prisma
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npx prisma generate && npm run build

# Remove dependências de desenvolvimento e gera o client de novo (o prune pode apagá-lo).
RUN npm prune --omit=dev && npx prisma generate

FROM node:22-alpine AS runner
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/dist ./dist

EXPOSE 3000
USER node

# Aplica migrations pendentes e só então sobe a API.
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && node dist/main.js"]
