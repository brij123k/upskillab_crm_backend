import {
  Body,
  Controller,
  Post,
} from '@nestjs/common';

import {
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { LeadLogic } from 'src/api/lead_management/lead/lead.logic';
import { PaymentService } from 'src/api/order_management/payment/payment.service';
import { CreateBootcampRegistrationDto } from 'src/dto/BootcampRegistration.dto';
import { BootCampService } from './bootcamp.service';
;

@ApiTags('Bootcamp')
@Controller('bootcamp')
export class BootcampController {
  constructor(
    private readonly leadLogic: LeadLogic,
    private readonly paymentService: PaymentService,
    private readonly bootCampService: BootCampService,
  ) {}

  @Post('register')
  @ApiOperation({
    summary: 'Register student for bootcamp',
  })
  register(
    @Body() dto: CreateBootcampRegistrationDto,
  ) {
    return this.bootCampService.register(dto);
  }

  @Post('payment-link')
@ApiOperation({
  summary: 'Create Cashfree payment link for bootcamp registration',
})
async createBootcampPaymentLink(
  @Body() body: {
    leadId: number;
    amount: number;
  },
) {
  return this.paymentService.createBootcampPaymentLink(body);
}

 @Post('payment/webhook')
  @ApiOperation({
    summary: 'Cashfree Bootcamp payment webhook',
  })
  async paymentWebhook(
    @Body() body: any,
  ) {
    return this.bootCampService.handlePaymentWebhook(body);
  }

}