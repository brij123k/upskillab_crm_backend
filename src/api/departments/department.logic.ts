import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DepartmentData } from './department.data';
import { CreateDepartmentDto,UpdateDepartmentDto } from 'src/dto/department.dto';
import { Types } from 'mongoose';

@Injectable()
export class DepartmentLogic {
  constructor(private readonly departmentData: DepartmentData) {}

  async create(dto: CreateDepartmentDto) {
    const exists = await this.departmentData.findByName(dto.name);
    if (exists) {
      throw new BadRequestException(
        'Department with this name already exists',
      );
    }

    return this.departmentData.create({...dto, parentDepartmentId:new Types.ObjectId(dto.parentDepartmentId)});
  }

  findAll() {
    return this.departmentData.findAll();
  }

  async findOne(id: string) {
    const dept = await this.departmentData.findById(id);
    if (!dept) throw new NotFoundException('Department not found');
    return dept;
  }

  async update(id: string, dto: UpdateDepartmentDto) {
    const dept = await this.departmentData.update(id, dto);
    if (!dept) throw new NotFoundException('Department not found');
    return dept;
  }

  async delete(id: string) {
    const dept = await this.departmentData.delete(id);
    if (!dept) throw new NotFoundException('Department not found');
    return { message: 'Department deleted successfully' };
  }
}
