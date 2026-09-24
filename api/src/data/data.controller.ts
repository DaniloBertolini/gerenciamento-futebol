import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import { CurrentUser, type AuthenticatedUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { GameService } from './game.service';
import { PlayersService } from './players.service';
import * as s from './schemas';
import { StateService } from './state.service';

type User = AuthenticatedUser;

@Controller()
export class DataController {
  constructor(
    private readonly state: StateService,
    private readonly players: PlayersService,
    private readonly game: GameService,
  ) {}

  // ---------- Estado geral ----------
  @Get('state')
  getState(@CurrentUser() user: User) {
    return this.state.getState(user.id);
  }

  @HttpCode(204)
  @Put('selection')
  async setSelection(@CurrentUser() user: User, @Body(new ZodPipe(s.selectionSchema)) body: s.Selection) {
    await this.state.setSelection(user.id, body);
  }

  @HttpCode(204)
  @Patch('settings')
  async updateSettings(@CurrentUser() user: User, @Body(new ZodPipe(s.settingsSchema)) body: s.SettingsInput) {
    await this.state.updateSettings(user.id, body);
  }

  @HttpCode(204)
  @Put('draw')
  async saveDraw(@CurrentUser() user: User, @Body(new ZodPipe(s.drawSchema)) body: s.DrawInput) {
    await this.state.saveDraw(user.id, body);
  }

  @HttpCode(204)
  @Delete('draw')
  async clearDraw(@CurrentUser() user: User) {
    await this.state.clearDraw(user.id);
  }

  @HttpCode(200)
  @Post('import')
  importBackup(@CurrentUser() user: User, @Body(new ZodPipe(s.importSchema)) body: s.ImportData) {
    return this.state.importBackup(user.id, body);
  }

  // ---------- Jogadores ----------
  @Post('players')
  createPlayer(@CurrentUser() user: User, @Body(new ZodPipe(s.createPlayerSchema)) body: s.CreatePlayer) {
    return this.players.create(user.id, body);
  }

  @Patch('players/:id')
  updatePlayer(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body(new ZodPipe(s.updatePlayerSchema)) body: s.UpdatePlayer,
  ) {
    return this.players.update(user.id, id, body);
  }

  @HttpCode(204)
  @Delete('players/:id')
  async removePlayer(@CurrentUser() user: User, @Param('id') id: string) {
    await this.players.remove(user.id, id);
  }

  // ---------- Cobrança do jogo ----------
  @Post('game')
  createGame(@CurrentUser() user: User, @Body(new ZodPipe(s.createGameSchema)) body: s.CreateGame) {
    return this.game.create(user.id, body);
  }

  @Patch('game')
  updateGame(@CurrentUser() user: User, @Body(new ZodPipe(s.updateGameSchema)) body: { total: number }) {
    return this.game.updateTotal(user.id, body.total);
  }

  @HttpCode(204)
  @Delete('game')
  async removeGame(@CurrentUser() user: User) {
    await this.game.remove(user.id);
  }

  @Post('game/players')
  addGamePlayer(@CurrentUser() user: User, @Body(new ZodPipe(s.addGamePlayerSchema)) body: { playerId: string }) {
    return this.game.addPlayer(user.id, body.playerId);
  }

  @Patch('game/players/:id')
  setMethod(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body(new ZodPipe(s.setMethodSchema)) body: { method: (typeof s.METHODS)[number] | null },
  ) {
    return this.game.setMethod(user.id, id, body.method);
  }

  @Delete('game/players/:id')
  removeGamePlayer(@CurrentUser() user: User, @Param('id') id: string) {
    return this.game.removePlayer(user.id, id);
  }
}
