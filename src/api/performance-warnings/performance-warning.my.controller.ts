import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { PerformanceWarningLogic } from './performance-warning.logic';

@ApiTags('Performance Warnings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RoleGuard)
@Controller('performance-warnings')
export class PerformanceWarningMyController {
  constructor(private readonly logic: PerformanceWarningLogic) {}

  @Get('me')
  @ApiOperation({ summary: 'List warnings for the logged in user' })
  findMine(@Req() req: any, @Query() query: any) {
    return this.logic.findAll({
      ...query,
      userId: req.user.userId,
    });
  }

  @Get('me/:id')
  @ApiOperation({ summary: 'Get a warning visible to the logged in user' })
  findMyWarning(@Req() req: any, @Param('id') id: string) {
    return this.logic.findMyWarning(req.user.userId, id);
  }
}
