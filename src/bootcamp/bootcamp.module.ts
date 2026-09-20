import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { BootcampController } from './bootcamp.controller';
import { LeadModule } from 'src/api/lead_management/lead/lead.module';
import { PaymentModule } from 'src/api/order_management/payment/payment.module';
import { BootCampService } from './bootcamp.service';
import { WhatsappModule } from 'src/api/whatsapp/whatsapp.module';
import { CommonModule } from 'src/common/services/common.module';
@Module({
  imports: [
    LeadModule,
    PaymentModule,
    WhatsappModule,
    CommonModule,
  ],
  providers: [
    BootCampService,
  ],
  controllers: [
    BootcampController,
  ],
})
export class BootcampModule {}