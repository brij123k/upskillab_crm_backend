import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { KraLogic } from './kra.logic';

@ApiTags('KRA')
@ApiBearerAuth()
@Controller('kra')
export class KraController {
  constructor(private readonly logic: KraLogic) {}

  @Post()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('Admin', 'hr')
  @ApiOperation({ summary: 'Create or update KRA settings for a role' })
  upsert(@Body() dto: any) {
    return this.logic.createOrUpdate(dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('Admin', 'hr')
  @ApiOperation({ summary: 'List all KRA settings' })
  findAll() {
    return this.logic.findAll();
  }

  @Get('compare')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Compare KRA metrics for a user and role' })
  compare(
    @Query('roleId') roleId: string,
    @Query('userId') userId: string,
    @Query('date') date?: string,
  ) {
    return this.logic.compareByRoleAndUser(roleId, userId, date ? new Date(date) : new Date());
  }

  @Get('role/:roleId')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('Admin', 'hr')
  @ApiOperation({ summary: 'Get KRA settings by roleId' })
  findByRole(@Param('roleId') roleId: string) {
    return this.logic.findByRoleId(roleId);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('Admin', 'hr')
  @ApiOperation({ summary: 'Get KRA settings by id' })
  findOne(@Param('id') id: string) {
    return this.logic.findById(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('Admin', 'hr')
  @ApiOperation({ summary: 'Update KRA settings by id' })
  update(@Param('id') id: string, @Body() dto: any) {
    return this.logic.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('Admin', 'hr')
  @ApiOperation({ summary: 'Delete KRA settings by id' })
  delete(@Param('id') id: string) {
    return this.logic.delete(id);
  }
}
