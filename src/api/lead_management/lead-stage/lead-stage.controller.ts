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
import { CreateLeadStageDto,UpdateLeadStageDto } from 'src/dto/lead-management/lead-stage.dto';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Roles } from 'src/common/decorators/roles.decorator';

@ApiTags('Lead Stages')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles('admin')
@Controller('lead-stages')
export class LeadStageController {
  constructor(private readonly logic: LeadStageLogic) {}

  
  @Post()
  @ApiOperation({ summary: 'Create lead stage' })
  create(@Body() dto: CreateLeadStageDto) {
    return this.logic.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all lead stages' })
  findAll() {
    return this.logic.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get lead stage by ID' })
  findOne(@Param('id') id: string) {
    return this.logic.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update lead stage' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateLeadStageDto,
  ) {
    return this.logic.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete lead stage' })
  remove(@Param('id') id: string) {
    return this.logic.delete(id);
  }
}
