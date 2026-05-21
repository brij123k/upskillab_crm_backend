import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { SourceCampaignLogic } from './source-campaign.logic';
import { CreateSourceCampaignDto, PublicSourceLeadDto, UpdateSourceCampaignDto } from 'src/dto/source-campaign.dto';
import { PermissionGuard } from 'src/common/guards/permission.guard';
import { RequirePermission } from 'src/common/decorators/permission.decorator';
import { PERMISSIONS } from 'src/common/constants/permissions.constant';

@ApiTags('Source Campaigns')
@Controller('source-campaigns')
export class SourceCampaignController {
  constructor(private readonly logic: SourceCampaignLogic) {}

  @UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
  @Roles('Admin', 'bd')
  @RequirePermission(
    PERMISSIONS.SOURCE_CAMPAIGN.MODULE,
    PERMISSIONS.SOURCE_CAMPAIGN.ACTIONS.CREATE,
  )
  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create source campaign' })
  create(@Body() dto: CreateSourceCampaignDto, @Req() req: any) {
    return this.logic.create(dto, req.user.userId);
  }

  @UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
  @Roles('Admin', 'bd')
  @RequirePermission(
    PERMISSIONS.SOURCE_CAMPAIGN.MODULE,
    PERMISSIONS.SOURCE_CAMPAIGN.ACTIONS.READ,
  )
  @Get()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List source campaigns' })
  findAll() {
    return this.logic.findAll();
  }

  @Get('public/:id')
  @ApiOperation({ summary: 'Get public source campaign info' })
  publicCampaign(@Param('id') id: string) {
    return this.logic.getPublicCampaign(id);
  }

  @Post('public/:id/lead')
  @ApiOperation({ summary: 'Submit a public lead for source campaign' })
  publicLead(@Param('id') id: string, @Body() dto: PublicSourceLeadDto) {
    return this.logic.submitPublicLead(id, dto);
  }

  @Get('report/comparison')
  @UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
  @Roles('Admin', 'bd')
  @RequirePermission(
    PERMISSIONS.SOURCE_CAMPAIGN.MODULE,
    PERMISSIONS.SOURCE_CAMPAIGN.ACTIONS.READ,
  )
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Source campaign comparison report' })
  report(@Query() query: any) {
    return this.logic.comparisonReport(query);
  }

  @UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
  @Roles('Admin', 'bd')
  @RequirePermission(
    PERMISSIONS.SOURCE_CAMPAIGN.MODULE,
    PERMISSIONS.SOURCE_CAMPAIGN.ACTIONS.READ,
  )
  @Get(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get source campaign by id' })
  findOne(@Param('id') id: string) {
    return this.logic.findOne(id);
  }

  @UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
  @Roles('Admin', 'bd')
  @RequirePermission(
    PERMISSIONS.SOURCE_CAMPAIGN.MODULE,
    PERMISSIONS.SOURCE_CAMPAIGN.ACTIONS.UPDATE,
  )
  @Patch(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update source campaign' })
  update(@Param('id') id: string, @Body() dto: UpdateSourceCampaignDto, @Req() req: any) {
    return this.logic.update(id, dto, req.user.userId);
  }

  @UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
  @Roles('Admin', 'bd')
  @RequirePermission(
    PERMISSIONS.SOURCE_CAMPAIGN.MODULE,
    PERMISSIONS.SOURCE_CAMPAIGN.ACTIONS.TOGGLE_STATUS,
  )
  @Patch(':id/toggle')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Toggle source campaign active status' })
  toggle(@Param('id') id: string, @Req() req: any) {
    return this.logic.toggleActive(id, req.user.userId);
  }
}
