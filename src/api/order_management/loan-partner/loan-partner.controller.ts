import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { LoanPartnerService } from './loan-partner.service';
import { CreateLoanPartnerDto,UpdateLoanPartnerDto } from 'src/dto/order_management/loan-partner.dto';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { PermissionGuard } from 'src/common/guards/permission.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { RequirePermission } from 'src/common/decorators/permission.decorator';
import { PERMISSIONS } from 'src/common/constants/permissions.constant';

@ApiTags('Loan Partner')
@Controller('loan-partner')
export class LoanPartnerController {
  constructor(private readonly service: LoanPartnerService) {}

  @UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
    @Roles('Admin', 'bd')
  @Post()
   @RequirePermission(
                     PERMISSIONS.LOANPARTNER.MODULE,
                     PERMISSIONS.LOANPARTNER.ACTIONS.CREATE,
                   )
  create(@Body() dto: CreateLoanPartnerDto) {
    return this.service.create(dto);
  }

  @UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
    @Roles('Admin', 'bd')
  @Get()
   @RequirePermission(
                     PERMISSIONS.LOANPARTNER.MODULE,
                     PERMISSIONS.LOANPARTNER.ACTIONS.READ,
                   )
  getAll() {
    return this.service.findAll();
  }

  @UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
    @Roles('Admin', 'bd')
  @Get(':id')
   @RequirePermission(
                     PERMISSIONS.LOANPARTNER.MODULE,
                     PERMISSIONS.LOANPARTNER.ACTIONS.READ,
                   )
  getOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
    @Roles('Admin', 'bd')
  @Patch(':id')
   @RequirePermission(
                     PERMISSIONS.LOANPARTNER.MODULE,
                     PERMISSIONS.LOANPARTNER.ACTIONS.UPDATE,
                   )
  update(@Param('id') id: string, @Body() dto: UpdateLoanPartnerDto) {
    return this.service.update(id, dto);
  }

  @UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
  @Roles('Admin', 'bd')
  @Patch('toggle/:id')
   @RequirePermission(
                     PERMISSIONS.LOANPARTNER.MODULE,
                     PERMISSIONS.LOANPARTNER.ACTIONS.TOGGLESTATUS,
                   )
  toggleStatus(@Param('id') id: string) {
    return this.service.toggleStatus(id);
  }

}