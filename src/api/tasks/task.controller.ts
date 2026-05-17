import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { CreateTaskDto } from 'src/dto/task/create-task.dto';
import { UpdateTaskDto } from 'src/dto/task/update-task.dto';
import { TaskStatus } from 'src/schema/task.schema';
import { TaskLogic } from './task.logic';
import { RequirePermission } from 'src/common/decorators/permission.decorator';
import { PERMISSIONS } from 'src/common/constants/permissions.constant';
import { PermissionGuard } from 'src/common/guards/permission.guard';

@ApiTags('Tasks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RoleGuard,PermissionGuard)
@Roles('Admin', 'bd')
@Controller('tasks')
export class TaskController {
  constructor(private readonly logic: TaskLogic) {}

      @RequirePermission(
         PERMISSIONS.TASK.MODULE,
         PERMISSIONS.TASK.ACTIONS.CREATE,
       )
  @Post()
  @ApiOperation({ summary: 'Create a task for an employee' })
  create(@Body() dto: CreateTaskDto, @Req() req: any) {
    return this.logic.create(dto, req.user.userId);
  }

      @RequirePermission(
         PERMISSIONS.TASK.MODULE,
         PERMISSIONS.TASK.ACTIONS.READ,
       )
  @Get()
  @ApiOperation({ summary: 'Get all tasks' })
  getAll(@Query() query: any) {
    return this.logic.getAll(query);
  }

      @RequirePermission(
         PERMISSIONS.TASK.MODULE,
         PERMISSIONS.TASK.ACTIONS.READ,
       )
  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get tasks assigned to the current user' })
  getMyTasks(@Req() req: any, @Query() query: any) {
    return this.logic.getMyTasks(req.user.userId, query);
  }

  @Get('me/:id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get a task assigned to the current user by id' })
  getMyTaskById(@Param('id') id: string, @Req() req: any) {
    return this.logic.getMyTaskById(req.user.userId, id);
  }

      @RequirePermission(
         PERMISSIONS.TASK.MODULE,
         PERMISSIONS.TASK.ACTIONS.READ,
       )
  @Get(':id')
  @ApiOperation({ summary: 'Get task by id' })
  getById(@Param('id') id: string) {
    return this.logic.getById(id);
  }

      @RequirePermission(
         PERMISSIONS.TASK.MODULE,
         PERMISSIONS.TASK.ACTIONS.UPDATE,
       )
  @Patch(':id')
  @ApiOperation({ summary: 'Update task details' })
  update(@Param('id') id: string, @Body() dto: UpdateTaskDto) {
    return this.logic.update(id, dto);
  }

      @RequirePermission(
         PERMISSIONS.TASK.MODULE,
         PERMISSIONS.TASK.ACTIONS.CHANGE_STATUS,
       )
  @Patch(':id/status')
  @ApiOperation({ summary: 'Update task status' })
  updateStatus(@Param('id') id: string, @Body() body: { status: TaskStatus }) {
    return this.logic.updateStatus(id, body.status);
  }

  @Patch('me/:id/status')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('bd')
  @ApiOperation({ summary: 'Update your assigned task status' })
  updateMyStatus(@Param('id') id: string, @Body() body: { status: TaskStatus }, @Req() req: any) {
    return this.logic.updateMyStatus(id, body.status, req.user.userId);
  }

  // @Delete(':id')
  // @ApiOperation({ summary: 'Delete task' })
  // delete(@Param('id') id: string) {
  //   return this.logic.delete(id);
  // }
}
