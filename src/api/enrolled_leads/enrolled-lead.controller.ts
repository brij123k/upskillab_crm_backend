import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { EnrolledPermissionGuard } from './enrolled-permission.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { RequirePermission } from 'src/common/decorators/permission.decorator';
import { PERMISSIONS } from 'src/common/constants/permissions.constant';
import {
  AssignEnrolledLeadsDto,
  BulkStageDto,
  CatalogQueryDto,
  EnrolledCallFeedbackDto,
  EnrolledLeadQueryDto,
  EnrolledStageDto,
  LogEnrolledActivityDto,
  PageQueryDto,
  UpdateEnrolledStageDto,
} from 'src/dto/enrolled_leads/enrolled-lead.dto';
import { EnrolledLeadService } from './enrolled-lead.service';
import { EnrolledLeadSyncService } from './enrolled-lead-sync.service';
import { EnrolledLeadStageService } from './enrolled-lead-stage.service';

const P = PERMISSIONS.ENROLLED_LEADS;

@ApiTags('Enrolled Leads')
@Controller('enrolled-leads')
@UseGuards(JwtAuthGuard, RoleGuard, EnrolledPermissionGuard)
@Roles('Admin', 'bd')
export class EnrolledLeadController {
  constructor(
    private readonly service: EnrolledLeadService,
    private readonly sync: EnrolledLeadSyncService,
    private readonly stages: EnrolledLeadStageService,
  ) {}

  // ---------------- static routes first ----------------

  @Get('meta')
  @RequirePermission(P.MODULE, P.ACTIONS.READ)
  @ApiOperation({
    summary:
      'Filter options: stages, courses, batches, statuses, batch statuses, last sync',
  })
  meta() {
    return this.service.meta();
  }

  @Get('courses')
  @RequirePermission(P.MODULE, P.ACTIONS.READ)
  @ApiOperation({
    summary: 'Upskillab courses stored in the CRM, with CRM student counts',
  })
  courses(@Query() query: CatalogQueryDto, @Req() req: any) {
    return this.service.listCourses(query, req.user);
  }

  @Get('batches')
  @RequirePermission(P.MODULE, P.ACTIONS.READ)
  @ApiOperation({
    summary: 'Upskillab batches stored in the CRM, with CRM student counts',
  })
  batches(@Query() query: CatalogQueryDto, @Req() req: any) {
    return this.service.listBatches(query, req.user);
  }

  @Get('stages')
  @RequirePermission(P.MODULE, P.ACTIONS.READ)
  @ApiOperation({
    summary: 'Enrolled lead stages (add includeInactive=true for all)',
  })
  listStages(@Query('includeInactive') includeInactive?: string) {
    return this.stages.list(includeInactive === 'true');
  }

  @Post('stages')
  @RequirePermission(P.MODULE, P.ACTIONS.MANAGE_STAGES)
  @ApiOperation({ summary: 'Add an enrolled lead stage' })
  createStage(@Body() dto: EnrolledStageDto) {
    return this.stages.create(dto);
  }

  @Patch('stages/:id')
  @RequirePermission(P.MODULE, P.ACTIONS.MANAGE_STAGES)
  @ApiOperation({
    summary: 'Rename, reorder, activate/deactivate or make default',
  })
  updateStage(@Param('id') id: string, @Body() dto: UpdateEnrolledStageDto) {
    return this.stages.update(id, dto);
  }

  @Get('sync/runs')
  @RequirePermission(P.MODULE, P.ACTIONS.READ)
  @ApiOperation({ summary: 'History of student syncs (nightly + Fetch more)' })
  syncRuns(@Query() query: PageQueryDto) {
    return this.sync.getRuns(query.page || 1, query.limit || 20);
  }

  @Post('sync')
  @RequirePermission(P.MODULE, P.ACTIONS.SYNC)
  @ApiOperation({
    summary:
      'Fetch students, courses and batches from Upskillab now. New students are added; existing ones are not duplicated (their Upskillab details are refreshed).',
  })
  runSync(@Req() req: any) {
    return this.sync.run(
      'MANUAL',
      String(req.user?.userId || req.user?._id || ''),
    );
  }

  @Post('assign')
  @RequirePermission(P.MODULE, P.ACTIONS.ASSIGN)
  @ApiOperation({ summary: 'Assign (or unassign) enrolled leads' })
  assign(@Body() dto: AssignEnrolledLeadsDto, @Req() req: any) {
    return this.service.assign(dto, req.user);
  }

  @Post('stage')
  @RequirePermission(P.MODULE, P.ACTIONS.UPDATE)
  @ApiOperation({ summary: 'Move several enrolled leads to a stage' })
  bulkStage(@Body() dto: BulkStageDto, @Req() req: any) {
    return this.service.bulkStage(dto, req.user);
  }

  // ---------------- calls ----------------

  @Get('calls/pending')
  @RequirePermission(P.MODULE, P.ACTIONS.CALL)
  @ApiOperation({
    summary: 'My finished enrolled-lead calls that still need details',
  })
  pendingCalls(@Req() req: any) {
    return this.service.pendingCalls(req.user);
  }

  @Post('calls/:callId/feedback')
  @RequirePermission(P.MODULE, P.ACTIONS.CALL)
  @ApiOperation({
    summary: 'Fill the call details (stage, outcome, remark) after a call',
  })
  callFeedback(
    @Param('callId') callId: string,
    @Body() dto: EnrolledCallFeedbackDto,
    @Req() req: any,
  ) {
    return this.service.submitCallFeedback(callId, dto, req.user);
  }

  // ---------------- list / detail ----------------

  @Get()
  @RequirePermission(P.MODULE, P.ACTIONS.READ)
  @ApiOperation({
    summary:
      'Enrolled leads with filters (search, stage, active, status, course, batch, batch status, assignee, enrolled date). Users without read_all see leads assigned to them or their team.',
  })
  list(@Query() query: EnrolledLeadQueryDto, @Req() req: any) {
    return this.service.list(query, req.user);
  }

  @Get(':id')
  @RequirePermission(P.MODULE, P.ACTIONS.READ)
  @ApiOperation({
    summary: 'Full student details, orders, courses, batches and history',
  })
  getOne(@Param('id') id: string, @Req() req: any) {
    return this.service.getOne(id, req.user);
  }

  @Post(':id/call')
  @RequirePermission(P.MODULE, P.ACTIONS.CALL)
  @ApiOperation({
    summary: 'Click to call this student (Smartflo rings your phone first)',
  })
  call(@Param('id') id: string, @Req() req: any) {
    return this.service.startCall(id, req.user);
  }

  @Get(':id/calls')
  @RequirePermission(P.MODULE, P.ACTIONS.READ)
  @ApiOperation({ summary: 'Calls with this student' })
  calls(@Param('id') id: string, @Req() req: any) {
    return this.service.listCalls(id, req.user);
  }

  @Post(':id/activity')
  @RequirePermission(P.MODULE, P.ACTIONS.UPDATE)
  @ApiOperation({
    summary:
      'Log a call / WhatsApp / email / meeting / note, optionally moving the lead to a new stage',
  })
  logActivity(
    @Param('id') id: string,
    @Body() dto: LogEnrolledActivityDto,
    @Req() req: any,
  ) {
    return this.service.logActivity(id, dto, req.user);
  }
}
