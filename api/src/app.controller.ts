import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from './common/decorators';

@Controller()
export class AppController {
  /** Health check do Render (e usado pelo front para "acordar" o servidor). */
  @Public()
  @SkipThrottle()
  @Get('health')
  health() {
    return { status: 'ok' };
  }
}
