import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CreateLoanPartnerDto, UpdateLoanPartnerDto } from 'src/dto/order_management/loan-partner.dto';
import { LoanPartner } from 'src/schema/order_Management/loan-partner.schema';

@Injectable()
export class LoanPartnerService {
  constructor(
    @InjectModel(LoanPartner.name)
    private model: Model<LoanPartner>,
  ) {}

  create(dto: CreateLoanPartnerDto) {
    return this.model.create(dto);
  }

  findAll() {
    return this.model.find();
  }

  findById(id: string) {
    return this.model.findById(id);
  }

  update(id: string, dto: UpdateLoanPartnerDto) {
    return this.model.findByIdAndUpdate(id, dto, { new: true });
  }

  async toggleStatus(id: string) {
    const existing = await this.model.findById(id);
    if (!existing) throw new Error('Loan Partner not found');
    return this.model.findByIdAndUpdate(
      id,
      { isActive: !existing.isActive },
      { new: true },
    );
  }
  
}