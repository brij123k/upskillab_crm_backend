import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { LeadStageLogic } from './lead-stage.logic';
import { CreateLeadStageDto, UpdateLeadStageDto } from 'src/dto/lead-management/lead-stage.dto';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Roles } from 'src/common/decorators/roles.decorator';

@ApiTags('Lead Stages')

@Controller('lead-stages')
export class LeadStageController {
  constructor(private readonly logic: LeadStageLogic) { }

  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('admin')
  @Post()
  @ApiOperation({ summary: 'Create lead stage' })
  create(@Body() dto: CreateLeadStageDto) {
    return this.logic.create(dto);
  }


  // @UseGuards(JwtAuthGuard, RoleGuard)
  // @Roles('admin')
  @Get()
  @ApiOperation({ summary: 'Get all lead stages' })
  findAll() {
    return this.logic.findAll();
  }


  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('admin')
  @Get(':id')
  @ApiOperation({ summary: 'Get lead stage by ID' })
  findOne(@Param('id') id: string) {
    return this.logic.findOne(id);
  }


  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('admin')
  @Patch(':id')
  @ApiOperation({ summary: 'Update lead stage' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateLeadStageDto,
  ) {
    return this.logic.update(id, dto);
  }


  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('admin')
  @Delete(':id')
  @ApiOperation({ summary: 'Delete lead stage' })
  remove(@Param('id') id: string) {
    return this.logic.delete(id);
  }
}
