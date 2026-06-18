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
import { ApiTags } from '@nestjs/swagger';
import { LevelService } from './level.service';
import { CreateLevelDto,UpdateLevelDto } from 'src/dto/create-level.dto';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { PermissionGuard } from 'src/common/guards/permission.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { RequirePermission } from 'src/common/decorators/permission.decorator';
import { PERMISSIONS } from 'src/common/constants/permissions.constant';
@ApiTags('Level')
@Controller('level')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles('Admin')
export class LevelController {
  constructor(
    private readonly levelService: LevelService,
  ) {}


  @Post()
  create(@Body() dto: CreateLevelDto) {
    return this.levelService.create(dto);
  }

  @Get()
  findAll() {
    return this.levelService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.levelService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateLevelDto,
  ) {
    return this.levelService.update(id, dto);
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.levelService.delete(id);
  }
}