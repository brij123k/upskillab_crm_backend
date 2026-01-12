import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RoleLogic } from './role.logic';
import { UpdateRoleDto } from 'src/dto/role/update-role.dto';
import { CreateRoleDto } from 'src/dto/role/create-role.dto';

@ApiTags('Roles')
@Controller('roles')
export class RoleController {
  constructor(private readonly roleLogic: RoleLogic) {}

  @Post()
  @ApiOperation({ summary: 'Create role' })
  create(@Body() dto: CreateRoleDto) {
    return this.roleLogic.createRole(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all roles' })
  findAll() {
    return this.roleLogic.getRoles();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get role by ID' })
  findOne(@Param('id') id: string) {
    return this.roleLogic.getRole(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update role' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.roleLogic.updateRole(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete role' })
  remove(@Param('id') id: string) {
    return this.roleLogic.deleteRole(id);
  }
}
