import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import type { Env } from './common/env';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    // 6 MB: a imagem do QR Code do Pix e a importação de backup passam do limite padrão (1 MB).
    // trustProxy: o Render fica atrás de um proxy; sem isso o limite de tentativas de login seria global.
    new FastifyAdapter({ bodyLimit: 6 * 1024 * 1024, trustProxy: true }),
  );
  const config = app.get(ConfigService<Env, true>);

  const origins = config
    .get('CORS_ORIGIN', { infer: true })
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins, methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] });

  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();

  const port = config.get('PORT', { infer: true });
  await app.listen(port, '0.0.0.0');
  console.log(`API ouvindo na porta ${port}`);
}

void bootstrap();
