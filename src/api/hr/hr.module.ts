import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  EmployeeDocument,
  EmployeeDocumentSchema,
  ExitRequest,
  ExitRequestSchema,
  ExpenseClaim,
  ExpenseClaimSchema,
} from 'src/schema/hr/hr.schema';
import { ProfileUploadModule } from '../file-uploader/file-uploader.module';
import { HrController } from './hr.controller';
import { HrService } from './hr.service';

@Module({
  imports: [
    ProfileUploadModule,
    MongooseModule.forFeature([
      { name: ExitRequest.name, schema: ExitRequestSchema },
      { name: EmployeeDocument.name, schema: EmployeeDocumentSchema },
      { name: ExpenseClaim.name, schema: ExpenseClaimSchema },
    ]),
  ],
  controllers: [HrController],
  providers: [HrService],
  exports: [HrService],
})
export class HrModule {}
