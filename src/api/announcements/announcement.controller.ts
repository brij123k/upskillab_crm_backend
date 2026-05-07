import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { CreateAnnouncementDto } from 'src/dto/announcement/create-announcement.dto';
import { AnnouncementLogic } from './announcement.logic';
import { PermissionGuard } from 'src/common/guards/permission.guard';
import { PERMISSIONS } from 'src/common/constants/permissions.constant';
import { RequirePermission } from 'src/common/decorators/permission.decorator';

@ApiTags('Announcements')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RoleGuard,PermissionGuard)
@Roles('Admin', 'bd')
@Controller('announcements')
export class AnnouncementController {
  constructor(private readonly logic: AnnouncementLogic) {}

  @RequirePermission(
           PERMISSIONS.ANNOUNCEMENT.MODULE,
           PERMISSIONS.ANNOUNCEMENT.ACTIONS.CREATE,
         )
  @Post()
  @ApiOperation({ summary: 'Create HR announcement' })
  create(@Body() dto: CreateAnnouncementDto, @Req() req: any) {
    return this.logic.create(dto, req.user.userId);
  }

    @RequirePermission(
           PERMISSIONS.ANNOUNCEMENT.MODULE,
           PERMISSIONS.ANNOUNCEMENT.ACTIONS.READ,
         )
  @Get()
  @ApiOperation({ summary: 'List announcements' })
  findAll(@Query() query: any) {
    return this.logic.findAll(query);
  }

    @RequirePermission(
           PERMISSIONS.ANNOUNCEMENT.MODULE,
           PERMISSIONS.ANNOUNCEMENT.ACTIONS.READ,
         )
  @Get(':id')
  @ApiOperation({ summary: 'Get announcement by id' })
  findOne(@Param('id') id: string) {
    return this.logic.findOne(id);
  }
}
