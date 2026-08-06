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

@ApiTags('Campaigns')
@Controller('campaigns')
export class CampaignController {
    constructor(private readonly logic: CampaignLogic) { }

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
) {
  return this.logic.sendBulkCampaign(
    dto,
  );
}
}
