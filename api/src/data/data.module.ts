import { Module } from '@nestjs/common';
import { DataController } from './data.controller';
import { GameService } from './game.service';
import { PlayersService } from './players.service';
import { StateService } from './state.service';

@Module({
  controllers: [DataController],
  providers: [StateService, PlayersService, GameService],
})
export class DataModule {}
