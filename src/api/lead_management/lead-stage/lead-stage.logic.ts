import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LeadStageData } from './lead-stage.data';
import { CreateLeadStageDto,UpdateLeadStageDto } from 'src/dto/lead-management/lead-stage.dto';

@Injectable()
export class LeadStageLogic {
  constructor(private readonly leadStageData: LeadStageData) {}

  async create(dto: CreateLeadStageDto) {
    const exists =
      await this.leadStageData.findByNameAndDepartment(
        dto.name,
        dto.departmentId,
      );

    if (exists) {
      throw new BadRequestException(
        'Lead stage already exists for this department',
      );
    }

    return this.leadStageData.create(dto);
  }

  findAll() {
    return this.leadStageData.findAll();
  }

  async findOne(id: string) {
    const stage = await this.leadStageData.findById(id);
    if (!stage) throw new NotFoundException('Lead stage not found');
    return stage;
  }

  async update(id: string, dto: UpdateLeadStageDto) {
    const stage = await this.leadStageData.update(id, dto);
    if (!stage) throw new NotFoundException('Lead stage not found');
    return stage;
  }

  async delete(id: string) {
    const stage = await this.leadStageData.delete(id);
    if (!stage) throw new NotFoundException('Lead stage not found');
    return { message: 'Lead stage deleted successfully' };
  }
}
