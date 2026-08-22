import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Roles } from 'src/common/decorators/roles.decorator';

import { HolidayLogic } from './holiday.logic';
import { CreateHolidayDto } from 'src/dto/holiday/create-holiday.dto';
import { UpdateHolidayDto } from 'src/dto/holiday/update-holiday.dto';

@ApiTags('Holiday')
@ApiBearerAuth()
@Controller('holiday')
export class HolidayController {
  constructor(
    private readonly logic: HolidayLogic,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('Admin')
  @ApiOperation({
    summary: 'Create a holiday',
  })
  create(
    @Body() dto: CreateHolidayDto,
  ) {
    return this.logic.create(dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('Admin')
  @ApiOperation({
    summary: 'List holidays',
  })
  findAll(
    @Query() query: any,
  ) {
    return this.logic.findAll(query);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('Admin')
  @ApiOperation({
    summary: 'Get holiday by id',
  })
  findOne(
    @Param('id') id: string,
  ) {
    return this.logic.findOne(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('Admin')
  @ApiOperation({
    summary: 'Update holiday',
  })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateHolidayDto,
  ) {
    return this.logic.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('Admin')
  @ApiOperation({
    summary: 'Delete holiday',
  })
  delete(
    @Param('id') id: string,
  ) {
    return this.logic.delete(id);
  }
}