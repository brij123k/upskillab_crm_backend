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
@UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
@Controller('announcements')
export class AnnouncementController {
  constructor(private readonly logic: AnnouncementLogic) {}

  @RequirePermission(
    PERMISSIONS.ANNOUNCEMENT.MODULE,
    PERMISSIONS.ANNOUNCEMENT.ACTIONS.CREATE,
  )
  @Roles('Admin', 'bd')
  @Post()
  @ApiOperation({ summary: 'Create HR announcement' })
  create(@Body() dto: CreateAnnouncementDto, @Req() req: any) {
    return this.logic.create(dto, req.user.userId);
  }

  @Get('me')
  @ApiOperation({ summary: 'Get announcements visible to the logged in user' })
  findMyAnnouncements(@Req() req: any, @Query() query: any) {
    return this.logic.findForUser(req.user.userId, query);
  }

  @Get('me/:id')
  @ApiOperation({ summary: 'Get a single announcement visible to the logged in user' })
  findMyAnnouncement(@Req() req: any, @Param('id') id: string) {
    return this.logic.findMyAnnouncement(req.user.userId, id);
  }

  @Get('user/:userId')
  @ApiOperation({ summary: 'Get announcements visible to a specific user' })
  findAnnouncementsForUser(@Param('userId') userId: string, @Query() query: any) {
    return this.logic.findForUser(userId, query);
  }

  @RequirePermission(
    PERMISSIONS.ANNOUNCEMENT.MODULE,
    PERMISSIONS.ANNOUNCEMENT.ACTIONS.READ,
  )
  @Roles('Admin', 'bd')
  @Get()
  @ApiOperation({ summary: 'List announcements' })
  findAll(@Query() query: any) {
    return this.logic.findAll(query);
  }

  @RequirePermission(
    PERMISSIONS.ANNOUNCEMENT.MODULE,
    PERMISSIONS.ANNOUNCEMENT.ACTIONS.READ,
  )
  @Roles('Admin', 'bd')
  @Get(':id')
  @ApiOperation({ summary: 'Get announcement by id' })
  findOne(@Param('id') id: string) {
    return this.logic.findOne(id);
  }
}
