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
import { ApiTags } from '@nestjs/swagger';
import { OrderService } from './order.service';
import { CreateOrderDto, UpdateOrderDto } from 'src/dto/order_management/create-order.dto';
import { Roles } from 'src/common/decorators/roles.decorator';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { PermissionGuard } from 'src/common/guards/permission.guard';
import { OrderFilterDto } from 'src/dto/order_management/orderFilterDto.dto';
import { RequirePermission } from 'src/common/decorators/permission.decorator';
import { PERMISSIONS } from 'src/common/constants/permissions.constant';
@ApiTags('Order')
@Controller('order')
export class OrderController {
    constructor(private readonly service: OrderService) { }

    @UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
    @Roles('Admin', 'bd')
    @Post()
     @RequirePermission(
                   PERMISSIONS.Orders.MODULE,
                   PERMISSIONS.Orders.ACTIONS.CREATE,
                 )
    create(@Body() dto: CreateOrderDto, @Req() req) {
        return this.service.createOrder(dto,req.user.userId);
    }

@UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
@Roles('Admin', 'bd')
@Get()
 @RequirePermission(
                   PERMISSIONS.Orders.MODULE,
                   PERMISSIONS.Orders.ACTIONS.READ,
                 )
getAll(@Query() query: any, @Req() req) {
  return this.service.findAll(query, req.user);
}

    @UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
    @Roles('Admin', 'bd')
    @Get(':id')
     @RequirePermission(
                   PERMISSIONS.Orders.MODULE,
                   PERMISSIONS.Orders.ACTIONS.READ,
                 )
    getOne(@Param('id') id: string) {
        return this.service.findById(id);
    }

    @UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
    @Roles('Admin', 'bd')
    @Patch(':id')
     @RequirePermission(
                   PERMISSIONS.Orders.MODULE,
                   PERMISSIONS.Orders.ACTIONS.UPDATE,
                 )
    update(@Param('id') id: string, @Body() dto: UpdateOrderDto, @Req() req:any) {
        return this.service.update(id, dto, req.user.userId);
    }

    // @UseGuards(JwtAuthGuard, RoleGuard)
    // @Roles('Admin', 'bd')
    // @Patch('cancel/:id')
    // cancel(@Param('id') id: string) {
    //     return this.service.cancelOrder(id);
    // }

    @UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
    @Roles('Admin', 'bd')
    @Patch('approve/:id')
     @RequirePermission(
                   PERMISSIONS.Orders.MODULE,
                   PERMISSIONS.Orders.ACTIONS.APPROVE,
                 )
    approve(
        @Param('id') id: string,
        @Req() req: any,
    ) {
        console.log('Approving order with ID:', id, 'by user:', req.user.userId);
        const approvedBy = req.user.userId;
        return this.service.approveOrder(id, approvedBy);
    }
    
    @UseGuards(JwtAuthGuard, RoleGuard)
    @Roles('Admin', 'bd')
    @Get('report/payment')
    report() {
        return this.service.paymentReport();
    }

    @UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
    @Roles('Admin', 'bd')
    @Get('loan/loan-emi')
     @RequirePermission(
                   PERMISSIONS.Orders.MODULE,
                   PERMISSIONS.Orders.ACTIONS.LOANS,
                 )
    getAllEmi(@Req() req: any,@Query() query:any) {
        return this.service.getAllEmi(query,req.user);
    }

    @UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
    @Roles('Admin', 'bd')
    @Patch('loan/loan-emi/:id')

    updateEnstallments(@Req() req: any,@Body() dto:any,@Param('id') id:string) {
        return this.service.updateInstallments(dto,req.user,id);
    }

    @UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
    @Roles('Admin', 'bd')
@Patch('loan/reminder/:id')
 @RequirePermission(
                   PERMISSIONS.Orders.MODULE,
                   PERMISSIONS.Orders.ACTIONS.SENDREMINDERS,
                 )
  sendReminder(@Param('id') id: string,@Body() dto: any) {
    return this.service.sendReminder(id,dto);
  }

    // @Get('subscription/:orderId')
    // getSubscription(@Param('orderId') orderId: string) {
    //     return this.subscriptionModel.findOne({ orderId });
    // }

//     @Get('subscription/:orderId')
// getSubscription(@Param('orderId') orderId: string) {
//   return this.subscriptionModel.findOne({ orderId });
// }
}