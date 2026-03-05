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
import {ApiTags } from '@nestjs/swagger';
import { PoolService } from './pool.service';
import { CreatePoolDto, UpdatePoolDto } from 'src/dto/pool.dto';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { RequirePermission } from 'src/common/decorators/permission.decorator';
import { PERMISSIONS } from 'src/common/constants/permissions.constant';
import { PermissionGuard } from 'src/common/guards/permission.guard';


@ApiTags('Pool')
@Controller('pool')
export class PoolController {
  constructor(private readonly poolService: PoolService) {}


  @UseGuards(JwtAuthGuard, RoleGuard,PermissionGuard)
   @Roles('Admin','bd')
  @Post()
  @RequirePermission(
               PERMISSIONS.POOL.MODULE,
               PERMISSIONS.POOL.ACTIONS.CREATE,
             )
  createPool(@Body() dto:CreatePoolDto){
    return this.poolService.createPool(dto)
  }


  @UseGuards(JwtAuthGuard, RoleGuard,PermissionGuard)
   @Roles('Admin','bd')
  @Get()
  @RequirePermission(
               PERMISSIONS.POOL.MODULE,
               PERMISSIONS.POOL.ACTIONS.READ,
             )
  
  getAll() {
    return this.poolService.findAllPools();
  }

  @UseGuards(JwtAuthGuard, RoleGuard,PermissionGuard)
   @Roles('Admin','bd')
  @Get(':id')
  @RequirePermission(
               PERMISSIONS.POOL.MODULE,
               PERMISSIONS.POOL.ACTIONS.READ,
             )
  getById(@Param('id') id: string) {
    return this.poolService.findPoolById(id);
  }


  @UseGuards(JwtAuthGuard, RoleGuard,PermissionGuard)
   @Roles('Admin','bd')
  @Patch(':id')
  @RequirePermission(
               PERMISSIONS.POOL.MODULE,
               PERMISSIONS.POOL.ACTIONS.UPDATE,
             )
  updateById(
    @Param('id') id: string,
    @Body() dto: UpdatePoolDto,
  ) {
    return this.poolService.updateById(id, dto);
  }

@UseGuards(JwtAuthGuard, RoleGuard,PermissionGuard)
@Roles('Admin','bd')
@Patch('toggle/:id')
@RequirePermission(
               PERMISSIONS.POOL.MODULE,
               PERMISSIONS.POOL.ACTIONS.UPDATE,
             )
  toggleActive(
    @Param('id') id:string,
  ){
  return this.poolService.toggelActive(id)
  }
}
