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
import { LeadLogic } from './lead.logic';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { CreateLeadDto,UpskillabLeadDto, UpdateLeadDto, ChangeLeadStatusDto, ChangeLeadStageDto } from 'src/dto/lead-management/lead.dto';
import { AssignLeadDto } from 'src/dto/lead-management/assign-lead.dto';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { ReassignLeadDto } from 'src/dto/lead-management/reassign-lead.dto';
import { LeadFilterDto } from 'src/dto/lead-management/lead-filter.dto';
import { RequirePermission } from 'src/common/decorators/permission.decorator';
import { PERMISSIONS } from 'src/common/constants/permissions.constant';
import { MergeLeadsDTO } from 'src/dto/lead-management/MergeLeadsDTO';
import { PermissionGuard } from 'src/common/guards/permission.guard';
import { AssignPoolDto } from 'src/dto/lead-management/assign-pool.dto';
import { StageChangeDto } from 'src/dto/lead-management/stageChange.dto';

@ApiTags('Leads')
@Controller('leads')
export class LeadController {
    constructor(private readonly logic: LeadLogic) { }

    @UseGuards(JwtAuthGuard, RoleGuard,PermissionGuard)
    @Roles('Admin', 'bd')
    @Post()
    @RequirePermission(
      PERMISSIONS.LEAD.MODULE,
      PERMISSIONS.LEAD.ACTIONS.CREATE,
    )
    @ApiOperation({ summary: 'Create lead' })
    create(@Body() dto: CreateLeadDto, @Req() req: any) {
        return this.logic.create(dto, req?.user);
    }

    @Post("upskillab")
    @ApiOperation({ summary: 'Add Lead from Upskill' })
    createByUpskillab(@Body() dto: UpskillabLeadDto) {
        return this.logic.createByUpskillab(dto);
    }
    @UseGuards(JwtAuthGuard, RoleGuard,PermissionGuard)
    @Roles('Admin', 'bd')
    @RequirePermission(
      PERMISSIONS.LEAD.MODULE,
      PERMISSIONS.LEAD.ACTIONS.READ,
    )
    @Get()
    @ApiOperation({ summary: 'Get all leads with filters & pagination' })
    findAll(@Query() query: LeadFilterDto,@Req() req: any) {
        return this.logic.findAll(query,req.user);
    }

  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('Admin', 'bd')
  @Post(':leadId/pcat-register')
  @ApiOperation({ summary: 'Register lead for ongoing PCAT exam (proxy)' })
  async registerForPcat(@Param('leadId') leadId: number, @Req() req: any) {
    return this.logic.registerForPcat(Number(leadId), req.user);
  }

  @UseGuards(JwtAuthGuard, RoleGuard,PermissionGuard)
  @Roles('Admin', 'bd')
  @RequirePermission(
      PERMISSIONS.LEAD.MODULE,
      PERMISSIONS.LEAD.ACTIONS.READ,
    )
  @Get('report/stage-summary')
  @ApiOperation({ summary: 'Get lead stage summary report' })
  stageSummaryReport(@Query() query: LeadFilterDto, @Req() req: any) {
      return this.logic.stageSummaryReport(query, req.user);
  }

  @UseGuards(JwtAuthGuard, RoleGuard,PermissionGuard)
  @Roles('Admin', 'bd')
  @RequirePermission(
      PERMISSIONS.LEAD.MODULE,
      PERMISSIONS.LEAD.ACTIONS.READ,
    )
  @Get('report/source-campaign-stage-summary')
  @ApiOperation({ summary: 'Get source campaign wise lead stage summary report' })
  sourceCampaignStageSummaryReport(@Query() query: LeadFilterDto, @Req() req: any) {
      return this.logic.sourceCampaignStageSummaryReport(query, req.user);
  }

  @UseGuards(JwtAuthGuard, RoleGuard,PermissionGuard)
  @Roles('Admin', 'bd')
  @RequirePermission(
      PERMISSIONS.LEAD.MODULE,
      PERMISSIONS.LEAD.ACTIONS.READ,
    )
  @Get('report/all-employees-stages')
  @ApiOperation({ summary: 'Get all employees with all stages breakdown' })
  allEmployeesStagesReport(@Query() query: LeadFilterDto, @Req() req: any) {
      return this.logic.allEmployeesStagesReport(query, req.user);
  }

@UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
    @Roles('Admin', 'bd')
    @RequirePermission(
                   PERMISSIONS.Orders.MODULE,
                   PERMISSIONS.Orders.ACTIONS.READ,
                 )
    @Get('report/pool-wise-data')
    poolWiseDataReport(@Query() query: any) {
        return this.logic.poolWiseDataReport(query);
    }

    @UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
@Roles('Admin', 'bd')
@RequirePermission(
  PERMISSIONS.LEAD.MODULE,
  PERMISSIONS.LEAD.ACTIONS.READ,
)
@Get('report/state-wise')
stateWiseReport(
  @Query() query: any,
  @Req() req: any,
) {
  return this.logic.stateWiseReport(query, req.user);
}


@UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
@Roles('Admin', 'bd')
@RequirePermission(
  PERMISSIONS.LEAD.MODULE,
  PERMISSIONS.LEAD.ACTIONS.READ,
)
@Get('report/state-wise-employee')
stateWiseEmployeeReport(
  @Query() query: any,
  @Req() req: any,
) {
  return this.logic.stateWiseEmployeeReport(
    query,
    req.user,
  );
}

  @UseGuards(JwtAuthGuard, RoleGuard,PermissionGuard)
  @Roles('Admin', 'bd')
  @Get(':id')
  @RequirePermission(
      PERMISSIONS.LEAD.MODULE,
      PERMISSIONS.LEAD.ACTIONS.READ,
    )
  @ApiOperation({ summary: 'Get lead by id' })
  findOne(@Param('id') id: string, @Req() req: any) {
      return this.logic.findOne(id, req?.user);
  }

   
    @UseGuards(JwtAuthGuard, RoleGuard,PermissionGuard)
    @Roles('Admin', 'bd')
    @RequirePermission(
      PERMISSIONS.LEAD.MODULE,
      PERMISSIONS.LEAD.ACTIONS.UPDATE,
    )
    @Patch(':id')
    @ApiOperation({ summary: 'Update lead' })
    update(
        @Param('id') id: string,
        @Body() dto: UpdateLeadDto,
        @Req() req: any
    ) {
        return this.logic.update(id, dto, req?.user);
    }
    
    @UseGuards(JwtAuthGuard, RoleGuard,PermissionGuard)
    @Roles('Admin', 'bd')
    @RequirePermission(
      PERMISSIONS.LEAD.MODULE,
      PERMISSIONS.LEAD.ACTIONS.STATUS_CHANGE,
    )
    @Patch(':id/status')
    @ApiOperation({ summary: 'Change lead status' })
    changeStatus(
        @Param('id') id: string,
        @Body() dto: ChangeLeadStatusDto,
        @Req() req: any
    ) {
        return this.logic.changeStatus(id, dto.status, req?.user);
    }


    @UseGuards(JwtAuthGuard, RoleGuard,PermissionGuard)
    @Roles('Admin', 'bd')
    @RequirePermission(
      PERMISSIONS.LEAD.MODULE,
      PERMISSIONS.LEAD.ACTIONS.STAGE_CHANGE,
    )
    @Patch(':id/stage')
    @ApiOperation({ summary: 'Change lead stage' })
    changeStage(
        @Param('id') id: string,
        @Body() dto: ChangeLeadStageDto,
        @Req() req: any
    ) {
        return this.logic.changeStage(id, dto, req?.user);
    }

    
    @UseGuards(JwtAuthGuard, RoleGuard,PermissionGuard)
    @Roles('Admin', 'bd')
    @RequirePermission(
      PERMISSIONS.LEAD.MODULE,
      PERMISSIONS.LEAD.ACTIONS.ASSIGN,
    )
    @Patch('lead/assign')
    @ApiOperation({
        summary:
            'Assign leads by leadIds, departmentId, or both',
    })
    assignLeads(
        @Body() dto: AssignLeadDto,
        @CurrentUser() user: any,
    ) {
        return this.logic.assignLeads(dto, user.userId);
    }

    @UseGuards(JwtAuthGuard, RoleGuard,PermissionGuard)
    @Roles('Admin', 'bd')
    @RequirePermission(
      PERMISSIONS.LEAD.MODULE,
      PERMISSIONS.LEAD.ACTIONS.ASSIGN,
    )
    @Patch('pool/assign')
    @ApiOperation({
        summary:
            'Assign Pool to leads by leadIds, or both',
    })
    assignPoolLeads(
        @Body() dto: AssignPoolDto,
        @CurrentUser() user: any,
    ) {
        return this.logic.assignPool(dto, user.userId);
    }

    @UseGuards(JwtAuthGuard, RoleGuard,PermissionGuard)
    @Roles('Admin', 'bd')
    @RequirePermission(
      PERMISSIONS.LEAD.MODULE,
      PERMISSIONS.LEAD.ACTIONS.STAGE_CHANGE,
    )
    @Patch('bulkStage/change')
    @ApiOperation({
        summary:
            'Assign Pool to leads by leadIds, or both',
    })
    bulkStageChange(
        @Body() dto: StageChangeDto,
        @CurrentUser() user: any,
    ) {
        return this.logic.bulkStagechange(dto, user.userId);
    }


    
    @UseGuards(JwtAuthGuard, RoleGuard,PermissionGuard)
    @Roles('Admin', 'bd')
    @RequirePermission(
      PERMISSIONS.LEAD.MODULE,
      PERMISSIONS.LEAD.ACTIONS.ASSIGN,
    )
    @Patch('reassign')
    @ApiOperation({
        summary: 'Pull back and reassign leads',
    })
    reassignLeads(
        @Body() dto: ReassignLeadDto,
        @CurrentUser() user: any,
    ) {
        return this.logic.pullBackAndReassign(
            dto.leadIds,
            dto.newAssignedTo,
            user.userId,
            dto.reason,
        );
    }


    @UseGuards(JwtAuthGuard, RoleGuard,PermissionGuard)
    @Roles('Admin', 'bd')
    @Get('user/:userId')
    @RequirePermission(
      PERMISSIONS.LEAD.MODULE,
      PERMISSIONS.LEAD.ACTIONS.READ,
    )
    @ApiOperation({ summary: 'Get all leads assigned to a user' })
    getByUser(@Param('userId') userId: string, @Req() req: any) {
        return this.logic.getLeadsByUser(userId, req?.user);
    }

    @UseGuards(JwtAuthGuard, RoleGuard,PermissionGuard)
    @Roles('Admin', 'bd')
    @Get('lead/:leadId')
    @RequirePermission(
      PERMISSIONS.LEAD.MODULE,
      PERMISSIONS.LEAD.ACTIONS.READ,
    )
    @ApiOperation({ summary: 'Get all leads by leadId' })
    getbyLeadId(@Param('leadId') leadId: number, @Req() req: any){
        return this.logic.getLeadByLeadId(leadId, req?.user)
    }



    @UseGuards(JwtAuthGuard, RoleGuard,PermissionGuard)
    @Roles('Admin', 'bd')
    @RequirePermission(
      PERMISSIONS.LEAD.MODULE,
      PERMISSIONS.LEAD.ACTIONS.UPDATE,
    )
    @Get('leaddoublicate/duplicates')  
    getDuplicates(@Req() req: any) {
     return this.logic.getDuplicateLeads(req?.user);
    }

@UseGuards(JwtAuthGuard, RoleGuard,PermissionGuard)
@Roles('Admin', 'bd')
@Post('leaddoublicate/merge')
mergeLeads(@Body() dto: MergeLeadsDTO, @Req() req) {
  return this.logic.mergeLeads(dto, req.user.userId);
}

@Get()
getSettings() {
  return this.logic.getSettings();
}

@Patch()
updateSettings(
  @Body() dto: any,
) {
  return this.logic.updateSettings(dto);
}
}
