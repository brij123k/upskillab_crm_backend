import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    Query,
    Req,
    UseGuards,
} from '@nestjs/common';
import {
    ApiBearerAuth,
    ApiOperation,
    ApiTags,
} from '@nestjs/swagger';
import { CampaignLogic } from './campaigns.service';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { RequirePermission } from 'src/common/decorators/permission.decorator';
import { PERMISSIONS } from 'src/common/constants/permissions.constant';
import { PermissionGuard } from 'src/common/guards/permission.guard';
import { BulkWhatsappDto } from 'src/api/whatsapp/dto/bulk-whatsapp.dto';
import { BulkCustomMessageDto } from '../whatsapp/dto/bulk-custom-message.dto';
import { GetCampaignsQueryDto } from './dto/get-campaigns-query.dto';
import { GetCampaignLogsQueryDto } from './dto/get-campaign-logs-query.dto';

@ApiTags('Campaigns')
@Controller('campaigns')
export class CampaignController {
    constructor(private readonly campaignService: CampaignLogic) { }

     @UseGuards(JwtAuthGuard, RoleGuard)
    @Roles('Admin', 'bd')
    @Post('bulk-whatsapp')
    @RequirePermission(
      PERMISSIONS.LEAD.MODULE,
      PERMISSIONS.LEAD.ACTIONS.CREATE,
    )
    @ApiOperation({ summary: 'Create lead' })
sendBulkCampaign(
  @Body() dto: BulkWhatsappDto,
  @Req() req:any,
) {
  return this.campaignService.sendBulkCampaign(
    dto,
    req.user,
  );
}

  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('Admin', 'bd')
@Post('bulk-custom-messages')
async sendBulkCustomMessages(
  @Body() dto: any,
   @Req() req:any,
) {
  console.log("dto",dto)
  return this.campaignService.sendBulkCustomMessages(
    dto,
    req.user,
  );
}

  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('Admin', 'bd')
@Get()
async getCampaigns(
  @Query() query: GetCampaignsQueryDto,
  @Req() req:any,
) {
  return this.campaignService.getCampaigns(
    query,
    req.user,
  );
}

  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('Admin', 'bd')
@Get(':campaignId/logs')
async getCampaignLogs(
  @Param('campaignId') campaignId: string,
  @Query() query: GetCampaignLogsQueryDto,
  @Req() req,
) {
  return this.campaignService.getCampaignLogs(
    campaignId,
    query,
    req.user,
  );
}
}
