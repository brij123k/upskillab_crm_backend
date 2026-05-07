import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { CreatePerformanceWarningDto } from 'src/dto/performance-warning/create-performance-warning.dto';
import { PerformanceWarningLogic } from './performance-warning.logic';

@ApiTags('Performance Warnings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles('Admin', 'hr')
@Controller('performance-warnings')
export class PerformanceWarningController {
  constructor(private readonly logic: PerformanceWarningLogic) {}

  @Post()
  @ApiOperation({ summary: 'Create a performance warning' })
  create(@Body() dto: CreatePerformanceWarningDto, @Req() req: any) {
    return this.logic.create(dto, req.user.userId);
  }

  @Get()
  @ApiOperation({ summary: 'List performance warnings' })
  findAll(@Query() query: any) {
    return this.logic.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get performance warning by id' })
  findOne(@Param('id') id: string) {
    return this.logic.findOne(id);
  }
}
