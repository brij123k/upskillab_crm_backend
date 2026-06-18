import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RoleLogic } from './role.logic';
import { UpdateRoleDto } from 'src/dto/role/update-role.dto';
import { CreateRoleDto } from 'src/dto/role/create-role.dto';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { PermissionGuard } from 'src/common/guards/permission.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { RequirePermission } from 'src/common/decorators/permission.decorator';
import { PERMISSIONS } from 'src/common/constants/permissions.constant';

@ApiTags('Roles')
@Controller('roles')
export class RoleController {
  constructor(private readonly roleLogic: RoleLogic) {}


  @UseGuards(JwtAuthGuard, RoleGuard,PermissionGuard)
  @Roles('Admin','bd')
  @Post()
    @RequirePermission(
                       PERMISSIONS.ROLE.MODULE,
                       PERMISSIONS.ROLE.ACTIONS.CREATE,
                     )
  @ApiOperation({ summary: 'Create role' })
  create(@Body() dto: CreateRoleDto) {
    return this.roleLogic.createRole(dto);
  }

    @UseGuards(JwtAuthGuard, RoleGuard,PermissionGuard)
  @Roles('Admin','bd')
  @Get()
      @RequirePermission(
                       PERMISSIONS.ROLE.MODULE,
                       PERMISSIONS.ROLE.ACTIONS.READ,
                     )
  @ApiOperation({ summary: 'Get all roles' })
  findAll() {
    return this.roleLogic.getRoles();
  }


    @UseGuards(JwtAuthGuard, RoleGuard,PermissionGuard)
  @Roles('Admin','bd')
  @Get(':id')
        @RequirePermission(
                       PERMISSIONS.ROLE.MODULE,
                       PERMISSIONS.ROLE.ACTIONS.READ,
                     )
  @ApiOperation({ summary: 'Get role by ID' })
  findOne(@Param('id') id: string) {
    return this.roleLogic.getRole(id);
  }


    @UseGuards(JwtAuthGuard, RoleGuard,PermissionGuard)
  @Roles('Admin','bd')
  @Patch(':id')
        @RequirePermission(
                       PERMISSIONS.ROLE.MODULE,
                       PERMISSIONS.ROLE.ACTIONS.UPDATE,
                     )
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
