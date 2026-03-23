import {
    Body,
    Controller,
    Get,
    Param,
    Patch,
    Post,
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
@ApiTags('Order')
@Controller('order')
export class OrderController {
    constructor(private readonly service: OrderService) { }

    @UseGuards(JwtAuthGuard, RoleGuard)
    @Roles('Admin', 'bd')
    @Post()
    create(@Body() dto: CreateOrderDto) {
        return this.service.createOrder(dto);
    }

    @UseGuards(JwtAuthGuard, RoleGuard)
    @Roles('Admin', 'bd')
    @Get()
    getAll() {
        return this.service.findAll();
    }

    @UseGuards(JwtAuthGuard, RoleGuard)
    @Roles('Admin', 'bd')
    @Get(':id')
    getOne(@Param('id') id: string) {
        return this.service.findById(id);
    }

    @UseGuards(JwtAuthGuard, RoleGuard)
    @Roles('Admin', 'bd')
    @Patch(':id')
    update(@Param('id') id: string, @Body() dto: UpdateOrderDto) {
        return this.service.update(id, dto);
    }

    // @UseGuards(JwtAuthGuard, RoleGuard)
    // @Roles('Admin', 'bd')
    // @Patch('cancel/:id')
    // cancel(@Param('id') id: string) {
    //     return this.service.cancelOrder(id);
    // }

    @UseGuards(JwtAuthGuard, RoleGuard)
    @Roles('Admin', 'bd')
    @Patch('approve/:id')
    approve(
        @Param('id') id: string,
        @Req() req: any,
    ) {
        const approvedBy = req.user.userId;
        return this.service.approveOrder(id, approvedBy);
    }

    @UseGuards(JwtAuthGuard, RoleGuard)
    @Roles('Admin', 'bd')
    @Get('report/payment')
    report() {
        return this.service.paymentReport();
    }

    // @Get('loan-emi')
    // getAllEmi() {
    //     return this.emiModel.find().populate('orderId');
    // }
}