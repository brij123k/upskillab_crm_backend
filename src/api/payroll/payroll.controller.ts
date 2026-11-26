import { Body, Controller, Get, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import {
  CalculatePayrollDto,
  CreateSalaryRevisionDto,
  CreateSalaryStructureDto,
  EntryIdsDto,
  GeneratePayslipsDto,
  HoldPaymentDto,
  IncrementSalaryDto,
  MarkPaidDto,
  PayrollAdjustmentDto,
  PayrollDecisionDto,
  SalaryInputDto,
  SalaryTemplateDto,
  StatutoryDetailsDto,
  UpdatePayrollEntryDto,
  UpdatePayrollSettingsDto,
  UpdateSalaryStructureDto,
  UpdateSalaryTemplateDto,
} from 'src/dto/payroll/payroll.dto';
import { PayrollService } from './payroll.service';
import { PayrollRunService } from './payroll-run.service';

/**
 * Payroll: salary rules, templates, CTC structures, revisions, monthly
 * payroll runs, adjustments, salary payments, payslips and reports.
 * Permissions (module "payroll"): read, manage_settings, manage_structures,
 * approve_structures, run_payroll, approve_payroll, manage_payments,
 * payslips, reports. Admins have all of them; everyone sees their own payslips.
 */
@ApiTags('Payroll')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles('Admin', 'bd', 'hr')
@Controller('payroll')
export class PayrollController {
  constructor(
    private readonly service: PayrollService,
    private readonly runs: PayrollRunService,
  ) {}

  @Get('access')
  @ApiOperation({ summary: 'Payroll actions the current user can do' })
  access(@Req() req: any) {
    return this.service.access(req.user);
  }

  /* ---------- salary rules ---------- */

  @Get('settings')
  @ApiOperation({ summary: 'Salary components (% of CTC) and PF / ESI / PT / auto-TDS rules' })
  getSettings(@Req() req: any) {
    return this.service.getSettings(req.user);
  }

  @Put('settings')
  @ApiOperation({ summary: 'Update salary rules (new version; approved structures keep their own copy)' })
  updateSettings(@Body() dto: UpdatePayrollSettingsDto, @Req() req: any) {
    return this.service.updateSettings(dto, req.user);
  }

  @Post('structures/preview')
  @ApiOperation({ summary: 'Calculate a CTC breakup with the current rules (nothing is saved)' })
  preview(@Body() dto: SalaryInputDto, @Req() req: any) {
    return this.service.previewFor(dto, req.user);
  }

  /* ---------- salary structure templates ---------- */

  @Get('templates')
  @ApiOperation({ summary: 'Salary structure templates (includeInactive=true for all)' })
  templates(@Req() req: any, @Query('includeInactive') includeInactive?: string) {
    return this.service.listTemplates(req.user, includeInactive === 'true');
  }

  @Post('templates')
  @ApiOperation({ summary: 'Create a salary structure template' })
  createTemplate(@Body() dto: SalaryTemplateDto, @Req() req: any) {
    return this.service.createTemplate(dto, req.user);
  }

  @Put('templates/:id')
  @ApiOperation({ summary: 'Update / activate / deactivate a template' })
  updateTemplate(@Param('id') id: string, @Body() dto: UpdateSalaryTemplateDto, @Req() req: any) {
    return this.service.updateTemplate(id, dto, req.user);
  }

  /* ---------- employees & CTC ---------- */

  @Get('employees')
  @ApiOperation({ summary: 'Employee salary listing (CTC in force on asOf, default today)' })
  employees(@Req() req: any, @Query('status') status?: string, @Query('asOf') asOf?: string) {
    return this.service.listEmployees(req.user, status, asOf);
  }

  @Get('employees/:id')
  @ApiOperation({ summary: 'Salary profile: current structure, all structures, revisions' })
  employee(@Param('id') id: string, @Req() req: any) {
    return this.service.employeeSalaryProfile(id, req.user);
  }

  @Put('employees/:id/statutory')
  @ApiOperation({ summary: 'UAN, PF a/c, ESI no., date of joining (shown on payslips)' })
  statutory(@Param('id') id: string, @Body() dto: StatutoryDetailsDto, @Req() req: any) {
    return this.service.updateStatutoryDetails(id, dto, req.user);
  }

  @Post('structures')
  @ApiOperation({ summary: 'Create a draft salary structure' })
  createStructure(@Body() dto: CreateSalaryStructureDto, @Req() req: any) {
    return this.service.createStructure(dto, req.user);
  }

  @Get('structures/:id')
  @ApiOperation({ summary: 'Fetch a salary structure' })
  getStructure(@Param('id') id: string, @Req() req: any) {
    return this.service.getStructure(id, req.user);
  }

  @Put('structures/:id')
  @ApiOperation({ summary: 'Update a draft salary structure' })
  updateStructure(@Param('id') id: string, @Body() dto: UpdateSalaryStructureDto, @Req() req: any) {
    return this.service.updateDraft(id, dto, req.user);
  }

  @Post('structures/:id/approve')
  @ApiOperation({ summary: 'Approve a draft salary structure' })
  approveStructure(@Param('id') id: string, @Req() req: any) {
    return this.service.approveStructure(id, req.user);
  }

  @Post('structures/:id/cancel')
  @ApiOperation({ summary: 'Cancel a draft salary structure' })
  cancelStructure(@Param('id') id: string, @Req() req: any) {
    return this.service.cancelDraft(id, req.user);
  }

  /* ---------- salary revision ---------- */

  @Post('revisions')
  @ApiOperation({ summary: 'Create a salary revision (draft structure, approve it to apply)' })
  createRevision(@Body() dto: CreateSalaryRevisionDto, @Req() req: any) {
    return this.service.createRevision(dto, req.user);
  }

  @Post('revisions/increment')
  @ApiOperation({ summary: 'Increment the CTC of one or more employees by a % (or to a new CTC)' })
  increment(@Body() dto: IncrementSalaryDto, @Req() req: any) {
    return this.service.incrementSalaries(dto, req.user);
  }

  @Get('revisions')
  @ApiOperation({ summary: 'Salary history of every employee (filters: from, to, employeeId, status)' })
  revisionHistory(@Req() req: any, @Query() query: any) {
    return this.service.revisionHistory(req.user, query);
  }

  @Get('revisions/:employeeId')
  @ApiOperation({ summary: 'Revision history of an employee' })
  revisions(@Param('employeeId') employeeId: string, @Req() req: any) {
    return this.service.listRevisions(employeeId, req.user);
  }

  /* ---------- monthly payroll ---------- */

  @Get('runs')
  @ApiOperation({ summary: 'Monthly payroll runs (latest first)' })
  listRuns(@Req() req: any) {
    return this.runs.listRuns(req.user);
  }

  @Post('runs/calculate')
  @ApiOperation({ summary: 'Calculate (or recalculate) the payroll of a month from salary structures + attendance' })
  calculate(@Body() dto: CalculatePayrollDto, @Req() req: any) {
    return this.runs.calculate(dto, req.user);
  }

  @Get('runs/:month')
  @ApiOperation({ summary: 'Payroll of a month with every employee entry' })
  getRun(@Param('month') month: string, @Req() req: any) {
    return this.runs.getRun(month, req.user);
  }

  @Post('runs/:month/review-all')
  @ApiOperation({ summary: 'Mark every pending entry as reviewed' })
  reviewAll(@Param('month') month: string, @Req() req: any) {
    return this.runs.markAllReviewed(month, req.user);
  }

  @Post('runs/:month/submit')
  @ApiOperation({ summary: 'Send the payroll for approval' })
  submit(@Param('month') month: string, @Body() dto: PayrollDecisionDto, @Req() req: any) {
    return this.runs.submit(month, dto, req.user);
  }

  @Post('runs/:month/approve')
  @ApiOperation({ summary: 'Approve the payroll (submitter cannot approve)' })
  approve(@Param('month') month: string, @Body() dto: PayrollDecisionDto, @Req() req: any) {
    return this.runs.approve(month, dto, req.user);
  }

  @Post('runs/:month/reject')
  @ApiOperation({ summary: 'Send the payroll back to draft with a reason' })
  reject(@Param('month') month: string, @Body() dto: PayrollDecisionDto, @Req() req: any) {
    return this.runs.reject(month, dto, req.user);
  }

  @Post('runs/:month/reopen')
  @ApiOperation({ summary: 'Reopen an approved payroll (only before any salary is paid)' })
  reopen(@Param('month') month: string, @Body() dto: PayrollDecisionDto, @Req() req: any) {
    return this.runs.reopen(month, dto, req.user);
  }

  @Patch('entries/:id')
  @ApiOperation({ summary: 'Review an entry: LOP days, hold, remarks' })
  updateEntry(@Param('id') id: string, @Body() dto: UpdatePayrollEntryDto, @Req() req: any) {
    return this.runs.updateEntry(id, dto, req.user);
  }

  /* ---------- adjustments ---------- */

  @Get('adjustments/types')
  adjustmentTypes() {
    return this.runs.adjustmentTypes();
  }

  @Get('adjustments')
  @ApiOperation({ summary: 'Payroll adjustments (filters: month, employeeId, status)' })
  adjustments(@Req() req: any, @Query() query: any) {
    return this.runs.listAdjustments(req.user, query);
  }

  @Post('adjustments')
  @ApiOperation({ summary: 'Add an incentive / bonus / arrear / recovery … for a month' })
  createAdjustment(@Body() dto: PayrollAdjustmentDto, @Req() req: any) {
    return this.runs.createAdjustment(dto, req.user);
  }

  @Post('adjustments/:id/cancel')
  cancelAdjustment(@Param('id') id: string, @Req() req: any) {
    return this.runs.cancelAdjustment(id, req.user);
  }

  /* ---------- salary payments ---------- */

  @Get('payments/:month')
  @ApiOperation({ summary: 'Salary payments of an approved payroll' })
  payments(@Param('month') month: string, @Req() req: any) {
    return this.runs.payments(month, req.user);
  }

  @Post('payments/manual-incentive')
  @ApiOperation({ summary: 'Add a manual incentive (or other change) from Salary Payments' })
  manualIncentive(@Body() dto: PayrollAdjustmentDto, @Req() req: any) {
    return this.runs.createAdjustment(dto, req.user, 'salary_payments');
  }

  @Post('payments/approve')
  @ApiOperation({ summary: 'Approve salary payments' })
  approvePayments(@Body() dto: EntryIdsDto, @Req() req: any) {
    return this.runs.approvePayments(dto, req.user);
  }

  @Post('payments/paid')
  @ApiOperation({ summary: 'Mark approved salaries as paid' })
  markPaid(@Body() dto: MarkPaidDto, @Req() req: any) {
    return this.runs.markPaid(dto, req.user);
  }

  @Post('payments/hold')
  @ApiOperation({ summary: 'Hold (or release) salary payments' })
  hold(@Body() dto: HoldPaymentDto, @Req() req: any) {
    return this.runs.holdPayments(dto, req.user);
  }

  /* ---------- payslips ---------- */

  @Post('payslips/generate')
  @ApiOperation({ summary: 'Generate payslips for an approved month' })
  generatePayslips(@Body() dto: GeneratePayslipsDto, @Req() req: any) {
    return this.runs.generatePayslips(dto, req.user);
  }

  @Get('payslips/my')
  @ApiOperation({ summary: 'My payslips' })
  myPayslips(@Req() req: any) {
    return this.runs.myPayslips(req.user);
  }

  @Get('payslips/month/:month')
  @ApiOperation({ summary: 'Payslips of a month (payroll:payslips)' })
  listPayslips(@Param('month') month: string, @Req() req: any) {
    return this.runs.listPayslips(month, req.user);
  }

  @Get('payslips/:entryId')
  @ApiOperation({ summary: 'One payslip with YTD figures (own, or payroll:payslips)' })
  payslip(@Param('entryId') entryId: string, @Req() req: any) {
    return this.runs.payslip(entryId, req.user);
  }

  /* ---------- reports ---------- */

  @Get('reports/payroll')
  @ApiOperation({ summary: 'Payroll report: month-wise totals + employee-wise summary (from, to = YYYY-MM)' })
  payrollReport(@Req() req: any, @Query() query: any) {
    return this.runs.payrollReport(req.user, query);
  }
}
