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
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { OrderService } from './order.service';
import { CreateOrderDto, UpdateOrderDto } from 'src/dto/order_management/create-order.dto';
import { Roles } from 'src/common/decorators/roles.decorator';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { PermissionGuard } from 'src/common/guards/permission.guard';
import { OrderFilterDto } from 'src/dto/order_management/orderFilterDto.dto';
import { RequirePermission } from 'src/common/decorators/permission.decorator';
import { PERMISSIONS } from 'src/common/constants/permissions.constant';
import {
    MarkCreditPaidDto,
    PendingCreditReportQueryDto,
    RevertCreditPaymentDto,
    UpdateOrderFinancialsDto,
} from 'src/dto/order_management/order-payment.dto';
import { PendingCreditService } from './credits/pending-credit.service';
import { PendingCreditNotificationService } from './credits/pending-credit-notification.service';
@ApiTags('Order')
@Controller('order')
export class OrderController {
    constructor(
        private readonly service: OrderService,
        private readonly pendingCreditService: PendingCreditService,
        private readonly pendingCreditNotifications: PendingCreditNotificationService,
    ) { }

    @UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
    @Roles('Admin', 'bd')
    @Post()
    @RequirePermission(
        PERMISSIONS.Orders.MODULE,
        PERMISSIONS.Orders.ACTIONS.CREATE,
    )
    create(@Body() dto: CreateOrderDto, @Req() req) {
        return this.service.createOrder(dto, req.user.userId);
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
    update(@Param('id') id: string, @Body() dto: UpdateOrderDto, @Req() req: any) {
        return this.service.update(id, dto, req.user);
    }

    // ================= PAYMENT SOURCES & CREDITS =================

    @UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
    @Roles('Admin', 'bd')
    @Get(':id/financials')
    @RequirePermission(
        PERMISSIONS.Orders.MODULE,
        PERMISSIONS.Orders.ACTIONS.READ,
    )
    @ApiOperation({ summary: 'Payment sources, credits, planned coverage and actual received revenue of an order' })
    async getFinancials(@Param('id') id: string, @Req() req: any) {
        await this.service.assertOrderAccess(id, req.user);
        return this.service.getFinancialSummary(id);
    }

    @UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
    @Roles('Admin', 'bd')
    @Patch(':id/financials')
    @RequirePermission(
        PERMISSIONS.Orders.MODULE,
        PERMISSIONS.Orders.ACTIONS.UPDATE,
    )
    @ApiOperation({
        summary:
            'Add/update lumpsum, loan, subscription entries and credits. The whole order is re-validated. Approved orders additionally require the approve permission; recording received money requires record_payment; reductions/refunds require revert_payment.',
    })
    async updateFinancials(
        @Param('id') id: string,
        @Body() dto: UpdateOrderFinancialsDto,
        @Req() req: any,
    ) {
        await this.service.assertOrderAccess(id, req.user);
        return this.service.updateFinancials(id, dto, req.user);
    }

    @UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
    @Roles('Admin', 'bd')
    @Post(':id/credits/:creditId/pay')
    @RequirePermission(
        PERMISSIONS.Orders.MODULE,
        PERMISSIONS.Orders.ACTIONS.RECORD_PAYMENT,
    )
    @ApiOperation({ summary: 'Mark a credit Paid with a verified payment reference' })
    async markCreditPaid(
        @Param('id') id: string,
        @Param('creditId') creditId: string,
        @Body() dto: MarkCreditPaidDto,
        @Req() req: any,
    ) {
        await this.service.assertOrderAccess(id, req.user);
        return this.service.markCreditPaid(id, creditId, dto, req.user);
    }

    @UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
    @Roles('Admin', 'bd')
    @Post(':id/credits/:creditId/revert')
    @RequirePermission(
        PERMISSIONS.Orders.MODULE,
        PERMISSIONS.Orders.ACTIONS.REVERT_PAYMENT,
    )
    @ApiOperation({ summary: 'Revert a Paid credit to Pending/Overdue (audited, reason required)' })
    async revertCreditPayment(
        @Param('id') id: string,
        @Param('creditId') creditId: string,
        @Body() dto: RevertCreditPaymentDto,
        @Req() req: any,
    ) {
        await this.service.assertOrderAccess(id, req.user);
        return this.service.revertCreditPayment(id, creditId, dto.reason, req.user);
    }

    // ================= PENDING CREDITS =================

    @UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
    @Roles('Admin', 'bd')
    @Get('report/pending-credits')
    @RequirePermission(
        PERMISSIONS.Orders.MODULE,
        PERMISSIONS.Orders.ACTIONS.PENDING_CREDITS,
    )
    @ApiOperation({
        summary:
            'Pending credit report (approved orders). Admins see all orders; other users see their own and their team\'s.',
    })
    pendingCreditsReport(@Query() query: PendingCreditReportQueryDto, @Req() req: any) {
        return this.pendingCreditService.getReport(query, req.user);
    }

    @UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
    @Roles('Admin')
    @Get('report/pending-credits/notifications')
    @RequirePermission(
        PERMISSIONS.Orders.MODULE,
        PERMISSIONS.Orders.ACTIONS.PENDING_CREDITS,
    )
    @ApiOperation({ summary: 'Execution history of the daily pending-credit notification' })
    pendingCreditNotificationHistory(@Query('page') page?: string, @Query('limit') limit?: string) {
        return this.pendingCreditNotifications.getHistory(
            Math.max(1, Number(page) || 1),
            Math.min(100, Math.max(1, Number(limit) || 20)),
        );
    }

    @UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
    @Roles('Admin')
    @Post('report/pending-credits/notifications/run')
    @RequirePermission(
        PERMISSIONS.Orders.MODULE,
        PERMISSIONS.Orders.ACTIONS.PENDING_CREDITS,
    )
    @ApiOperation({ summary: 'Run the pending-credit notification now (credits already notified today are skipped)' })
    runPendingCreditNotifications(@Req() req: any) {
        return this.pendingCreditNotifications.run('MANUAL', req.user?.userId);
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
@RequirePermission(
    PERMISSIONS.Orders.MODULE,
    PERMISSIONS.Orders.ACTIONS.READ,
)
@Get('report/consultant-performance')
consultantPerformanceReport(@Query() query: any) {
    return this.service.consultantPerformanceReport(query);
}

@UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
@Roles('Admin', 'bd')
@RequirePermission(
    PERMISSIONS.Orders.MODULE,
    PERMISSIONS.Orders.ACTIONS.READ,
)
@Get('report/consultant-performance/team')
@ApiOperation({
    summary:
        'Get consultant performance hierarchy with direct team members',
})
consultantPerformanceTeamReport(@Query() query: any) {
    return this.service.consultantPerformanceTeamReport(query);
}

    @UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
@Roles('Admin', 'bd')
@RequirePermission(
  PERMISSIONS.Orders.MODULE,
  PERMISSIONS.Orders.ACTIONS.READ,
)
@Get('report/consultant-performance/details')
consultantPerformanceDetails(@Query() query: any) {
  return this.service.consultantPerformanceDetails(query);
}

    @UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
    @Roles('Admin', 'bd')
    @RequirePermission(
        PERMISSIONS.Orders.MODULE,
        PERMISSIONS.Orders.ACTIONS.READ,
    )
    @ApiOperation({ summary: 'Get employee utilization report with lead assignment, dial metrics, PCAT, registration, and admission counts', description: 'activityDateFilter (today|week|month) or activityDateFrom + activityDateTo switches to employee activity: leads assigned / created, calls made and stage changes made by the employee in the period. The assigned/created filters are ignored then.' })
    @Get('report/employee-pool-utilization')
    employeePoolUtilizationReport(@Query() query: any) {
        return this.service.employeePoolUtilizationReport(query);
    }

@UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
@Roles('Admin', 'bd')
@RequirePermission(
  PERMISSIONS.Orders.MODULE,
  PERMISSIONS.Orders.ACTIONS.READ,
)
@ApiOperation({
  summary:
    'Get employee utilization hierarchy with direct team members',
  description:
    'Supports the same activityDateFilter / activityDateFrom / activityDateTo as the main report.',
})
@Get('report/employee-pool-utilization/team')
employeePoolUtilizationTeamReport(@Query() query: any) {
  return this.service.employeePoolUtilizationTeamReport(query);
}

    @Get('report/employee-stage-leads')
    @UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
    @Roles('Admin', 'bd')
    @RequirePermission(
        PERMISSIONS.REPORTS.MODULE,
        PERMISSIONS.REPORTS.ACTIONS.READ,
    )
    @ApiOperation({
        summary: 'Get employee leads by stage',
    })
    employeeStageLeads(
        @Query() query: any,
    ) {
        return this.service.employeeStageLeads(query);
    }


    @UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
    @Roles('Admin', 'bd')
    @RequirePermission(
        PERMISSIONS.Orders.MODULE,
        PERMISSIONS.Orders.ACTIONS.READ,
    )
    @Get('report/source-campaign-wise-lead-revenue')
    @ApiOperation({ summary: 'Get source and campaign wise lead and revenue report' })
    sourceCampaignWiseLeadRevenueReport(@Query() query: any) {
        return this.service.sourceCampaignWiseLeadRevenueReport(query);
    }

    @UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
    @Roles('Admin', 'bd')
    @RequirePermission(
        PERMISSIONS.Orders.MODULE,
        PERMISSIONS.Orders.ACTIONS.READ,
    )
    @Get('report/state-lead-stage-revenue')
    @ApiOperation({ summary: 'Get state and lead stage wise revenue report' })
    stateLeadStageRevenueReport(@Query() query: any) {
        return this.service.stateLeadStageRevenueReport(query);
    }

    @UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
@Roles('Admin', 'bd')
@RequirePermission(
  PERMISSIONS.Orders.MODULE,
  PERMISSIONS.Orders.ACTIONS.READ,
)
@Get('report/employee-pool-revenue')
@ApiOperation({
  summary: 'Get employee pool revenue report grouped by month',
})
employeePoolRevenueReport(@Query() query: any) {
  return this.service.employeePoolRevenueReport(query);
}


@UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
@Roles('Admin', 'bd')
@RequirePermission(
  PERMISSIONS.Orders.MODULE,
  PERMISSIONS.Orders.ACTIONS.READ,
)
@Get('report/employee-pool-revenue/team')
@ApiOperation({
  summary: 'Get direct team employee pool revenue report',
})
employeePoolRevenueTeamReport(@Query() query: any) {
  return this.service.employeePoolRevenueTeamReport(query);
}

    @UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
    @Roles('Admin', 'bd')
    @Get('loan/loan-emi')
    @RequirePermission(
        PERMISSIONS.Orders.MODULE,
        PERMISSIONS.Orders.ACTIONS.LOANS,
    )
    getAllEmi(@Req() req: any, @Query() query: any) {
        return this.service.getAllEmi(query, req.user);
    }

    @UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
    @Roles('Admin', 'bd')
    @Patch('loan/loan-emi/:id')

    updateEnstallments(@Req() req: any, @Body() dto: any, @Param('id') id: string) {
        return this.service.updateInstallments(dto, req.user, id);
    }

    @UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
    @Roles('Admin', 'bd')
    @Patch('loan/reminder/:id')
    @RequirePermission(
        PERMISSIONS.Orders.MODULE,
        PERMISSIONS.Orders.ACTIONS.SENDREMINDERS,
    )
    sendReminder(@Param('id') id: string, @Body() dto: any) {
        return this.service.sendReminder(id, dto);
    }


   @UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
@Roles('Admin', 'bd')
@RequirePermission(
  PERMISSIONS.Orders.MODULE,
  PERMISSIONS.Orders.ACTIONS.READ,
)
@Get('report/monthly-revenue-graph')
@ApiOperation({
  summary: 'Get monthly revenue graph for current user/team',
})
monthlyRevenueGraph(
  @Req() req: any,
  @Query() query: any,
) {
  return this.service.monthlyRevenueGraph(
    query,
    req.user,
  );
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
