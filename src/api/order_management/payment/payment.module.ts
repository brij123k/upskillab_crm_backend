import { Module } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { OrderModule } from '../order.module';

@Module({
  imports: [OrderModule],
  providers: [PaymentService],
  controllers: [PaymentController],
})
export class PaymentModule {}