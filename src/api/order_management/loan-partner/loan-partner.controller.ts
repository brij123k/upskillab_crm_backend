import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { LoanPartnerService } from './loan-partner.service';
import { CreateLoanPartnerDto,UpdateLoanPartnerDto } from 'src/dto/order_management/loan-partner.dto';

@ApiTags('Loan Partner')
@Controller('loan-partner')
export class LoanPartnerController {
  constructor(private readonly service: LoanPartnerService) {}

  @Post()
  create(@Body() dto: CreateLoanPartnerDto) {
    return this.service.create(dto);
  }

  @Get()
  getAll() {
    return this.service.findAll();
  }

  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateLoanPartnerDto) {
    return this.service.update(id, dto);
  }

  @Patch('toggle/:id')
  toggleStatus(@Param('id') id: string) {
    return this.service.toggleStatus(id);
  }
}