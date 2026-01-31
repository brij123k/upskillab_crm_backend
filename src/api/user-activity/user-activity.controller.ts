import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { UserActivityLogic } from './user-activity.logic';

@ApiTags('User Activity')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('user-activities')
export class UserActivityController {
  constructor(private readonly logic: UserActivityLogic) {}

  @Get('user/:userId')
  @ApiOperation({ summary: 'Get all activities of a user' })
  getByUser(@Param('userId') userId: string) {
    return this.logic.getByUser(userId);
  }
}
