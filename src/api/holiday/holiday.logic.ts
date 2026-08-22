import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { Types } from 'mongoose';

import { HolidayData } from './holiday.data';
import { CreateHolidayDto } from 'src/dto/holiday/create-holiday.dto';
import { UpdateHolidayDto } from 'src/dto/holiday/update-holiday.dto';

@Injectable()
export class HolidayLogic {
  constructor(
    private readonly data: HolidayData,
  ) {}

  private startOfDay(input: Date) {
    const date = new Date(input);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  async create(dto: CreateHolidayDto) {
    if (!dto?.date) {
      throw new BadRequestException('Holiday date is required');
    }

    const date = new Date(dto.date);

    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('Invalid holiday date');
    }

    const normalizedDate = this.startOfDay(date);

    const existing = await this.data.findByDate(normalizedDate);

    if (existing) {
      throw new ConflictException(
        'A holiday already exists for this date',
      );
    }

    return this.data.create({
      name: dto.name.trim(),
      date: normalizedDate,
      description: dto.description?.trim(),
      isActive: dto.isActive ?? true,
    });
  }

  findAll(query: any = {}) {
    return this.data.findAll(query);
  }

  async findOne(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid holiday id');
    }

    const holiday = await this.data.findById(id);

    if (!holiday) {
      throw new NotFoundException('Holiday not found');
    }

    return holiday;
  }

  async update(id: string, dto: UpdateHolidayDto) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid holiday id');
    }

    const existing = await this.data.findById(id);

    if (!existing) {
      throw new NotFoundException('Holiday not found');
    }

    const payload: any = {};

    if (dto.name !== undefined) {
      payload.name = dto.name.trim();
    }

    if (dto.description !== undefined) {
      payload.description = dto.description?.trim();
    }

    if (dto.isActive !== undefined) {
      payload.isActive = dto.isActive;
    }

    if (dto.date !== undefined) {
      const date = new Date(dto.date);

      if (Number.isNaN(date.getTime())) {
        throw new BadRequestException('Invalid holiday date');
      }

      const normalizedDate = this.startOfDay(date);

      const duplicate = await this.data.findByDate(normalizedDate);

      if (
        duplicate &&
        duplicate._id.toString() !== id
      ) {
        throw new ConflictException(
          'A holiday already exists for this date',
        );
      }

      payload.date = normalizedDate;
    }

    return this.data.update(id, payload);
  }

  async delete(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid holiday id');
    }

    const existing = await this.data.findById(id);

    if (!existing) {
      throw new NotFoundException('Holiday not found');
    }

    return this.data.delete(id);
  }

  async isHoliday(date: Date) {
    const normalizedDate = this.startOfDay(date);

    return this.data.findByDate(normalizedDate);
  }
}