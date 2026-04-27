import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { CreateSubscriptionDto } from 'src/dto/order_management/createsubscription.dto';
import { Roles } from 'src/common/decorators/roles.decorator';
import { RoleGuard } from 'src/common/guards/role.guard';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';

@Controller('subscription')
export class SubscriptionController {
  constructor(private readonly service: SubscriptionService) {}

  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('Admin', 'bd')
  @Post('create')
  create(@Body() dto: CreateSubscriptionDto) {
    return this.service.create(dto);
  }

  @Post('webhook/cashfree')
  webhook(@Req() req: any) {
        console.log(req)
    return this.service.webhook(req.body);
  }


  @Get(":orderId")
  getSubscription(@Param('orderId') orderId:string){

    return this.service.getSubscription(orderId)
  }


}