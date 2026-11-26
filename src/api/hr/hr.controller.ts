import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import {
  CreateDocumentDto,
  CreateExitDto,
  CreateExpenseDto,
  DecideExitDto,
  DecideExpenseDto,
  PayExpenseDto,
} from 'src/dto/hr/hr.dto';
import { HrService } from './hr.service';

/**
 * HR: exit management, employee documents, expenses, employee report.
 * Every logged-in user reaches these routes; the service checks the "hr"
 * permissions (approve_exit, manage_documents, manage_expenses, reports).
 */
@ApiTags('HR')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles('Admin', 'bd', 'hr')
@Controller('hr')
export class HrController {
  constructor(private readonly service: HrService) {}

  @Get('access')
  @ApiOperation({ summary: 'Which HR actions the current user can do' })
  access(@Req() req: any) {
    return this.service.access(req.user);
  }

  @Get('employees')
  @ApiOperation({ summary: 'Employees for pickers (everyone for HR, own team for managers)' })
  employees(@Req() req: any, @Query('scope') scope?: string) {
    return this.service.employeesForPicker(req.user, scope);
  }

  @Post('upload')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Upload a document / receipt (PDF, image, Word, Excel; max 10 MB)' })
  upload(@UploadedFile() file: Express.Multer.File, @Query('folder') folder?: string) {
    return this.service.upload(file, folder || 'documents');
  }

  /* ---------------- exit management ---------------- */

  @Get('exits/options')
  exitOptions() {
    return this.service.exitOptions();
  }

  @Get('exits/my')
  @ApiOperation({ summary: 'My exit requests' })
  myExits(@Req() req: any) {
    return this.service.myExits(req.user);
  }

  @Post('exits')
  @ApiOperation({ summary: 'Raise an exit (resignation) request' })
  createExit(@Body() dto: CreateExitDto, @Req() req: any) {
    return this.service.createExit(dto, req.user);
  }

  @Post('exits/:id/withdraw')
  @ApiOperation({ summary: 'Withdraw my pending exit request' })
  withdrawExit(@Param('id') id: string, @Req() req: any) {
    return this.service.withdrawExit(id, req.user);
  }

  @Get('exits')
  @ApiOperation({ summary: 'All exit requests (hr:approve_exit)' })
  listExits(@Req() req: any, @Query() query: any) {
    return this.service.listExits(req.user, query);
  }

  @Post('exits/:id/decision')
  @ApiOperation({ summary: 'Approve (deactivates the account) or reject an exit request' })
  decideExit(@Param('id') id: string, @Body() dto: DecideExitDto, @Req() req: any) {
    return this.service.decideExit(id, dto, req.user);
  }

  /* ---------------- employee documents ---------------- */

  @Get('documents/types')
  documentTypes() {
    return this.service.documentTypes();
  }

  @Get('documents')
  @ApiOperation({ summary: 'Employee documents (mine=true for my own)' })
  listDocuments(@Req() req: any, @Query() query: any) {
    return this.service.listDocuments(req.user, query);
  }

  @Post('documents')
  @ApiOperation({ summary: 'Add a document for an employee (HR / admin / reporting senior)' })
  createDocument(@Body() dto: CreateDocumentDto, @Req() req: any) {
    return this.service.createDocument(dto, req.user);
  }

  @Delete('documents/:id')
  deleteDocument(@Param('id') id: string, @Req() req: any) {
    return this.service.deleteDocument(id, req.user);
  }

  /* ---------------- expenses ---------------- */

  @Get('expenses/categories')
  expenseCategories() {
    return this.service.expenseCategories();
  }

  @Get('expenses')
  @ApiOperation({ summary: 'Expense claims (all for hr:manage_expenses, otherwise my own)' })
  listExpenses(@Req() req: any, @Query() query: any) {
    return this.service.listExpenses(req.user, query);
  }

  @Post('expenses')
  @ApiOperation({ summary: 'Submit an expense claim' })
  createExpense(@Body() dto: CreateExpenseDto, @Req() req: any) {
    return this.service.createExpense(dto, req.user);
  }

  @Post('expenses/:id/decision')
  @ApiOperation({ summary: 'Approve or reject an expense' })
  decideExpense(@Param('id') id: string, @Body() dto: DecideExpenseDto, @Req() req: any) {
    return this.service.decideExpense(id, dto, req.user);
  }

  @Post('expenses/:id/pay')
  @ApiOperation({ summary: 'Mark an approved expense as paid' })
  payExpense(@Param('id') id: string, @Body() dto: PayExpenseDto, @Req() req: any) {
    return this.service.payExpense(id, dto, req.user);
  }

  @Delete('expenses/:id')
  @ApiOperation({ summary: 'Delete my submitted expense' })
  deleteExpense(@Param('id') id: string, @Req() req: any) {
    return this.service.deleteExpense(id, req.user);
  }

  /* ---------------- reports ---------------- */

  @Get('reports/employees')
  @ApiOperation({ summary: 'Employee report (hr:reports)' })
  employeeReport(@Req() req: any, @Query() query: any) {
    return this.service.employeeReport(req.user, query);
  }
}
