import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  PayrollAdjustment,
  PayrollAdjustmentSchema,
  PayrollAuditLog,
  PayrollAuditLogSchema,
  PayrollEntry,
  PayrollEntrySchema,
  PayrollRun,
  PayrollRunSchema,
  PayrollSettings,
  PayrollSettingsSchema,
  SalaryRevision,
  SalaryRevisionSchema,
  SalaryStructure,
  SalaryStructureSchema,
  SalaryTemplate,
  SalaryTemplateSchema,
} from 'src/schema/payroll/payroll.schema';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';
import { PayrollRunService } from './payroll-run.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PayrollSettings.name, schema: PayrollSettingsSchema },
      { name: SalaryStructure.name, schema: SalaryStructureSchema },
      { name: SalaryRevision.name, schema: SalaryRevisionSchema },
      { name: PayrollAuditLog.name, schema: PayrollAuditLogSchema },
      { name: SalaryTemplate.name, schema: SalaryTemplateSchema },
      { name: PayrollRun.name, schema: PayrollRunSchema },
      { name: PayrollEntry.name, schema: PayrollEntrySchema },
      { name: PayrollAdjustment.name, schema: PayrollAdjustmentSchema },
    ]),
  ],
  controllers: [PayrollController],
  providers: [PayrollService, PayrollRunService],
  exports: [PayrollService, PayrollRunService],
})
export class PayrollModule {}
