import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { CreateUserLogDto } from 'src/dto/user/create-user-log.dto';
import { UserLogLogic } from './user-log.logic';
import { Roles } from 'src/common/decorators/roles.decorator';
import { RoleGuard } from 'src/common/guards/role.guard';

@ApiTags('User Logs')
@Controller('user-logs')
export class UserLogController {
  constructor(private readonly logic: UserLogLogic) {}

  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('Admin')
  @Post()
  @ApiOperation({ summary: 'Create a user log entry' })
  create(@Body() dto: CreateUserLogDto) {
    return this.logic.create(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  @ApiOperation({ summary: 'Get current user log history' })
  getMe(@Req() req: any) {
    return this.logic.getByUser(req.user.userId);
  }

  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('Admin')
  @Get('user/:userId')
  @ApiOperation({ summary: 'Get logs for a specific user' })
  getByUser(@Param('userId') userId: string) {
    return this.logic.getByUser(userId);
  }

  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('Admin')
  @Get()
  @ApiOperation({ summary: 'Get all user logs' })
  getAll(@Query() query: any) {
    return this.logic.getAll(query);
  }
}
