import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  LoanPartner,
  LoanPartnerSchema,
} from 'src/schema/order_Management/loan-partner.schema';
import { LoanPartnerService } from './loan-partner.service';
import { LoanPartnerController } from './loan-partner.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: LoanPartner.name, schema: LoanPartnerSchema },
    ]),
  ],
  providers: [LoanPartnerService],
  controllers: [LoanPartnerController],
  exports: [LoanPartnerService],
})
export class LoanPartnerModule {}