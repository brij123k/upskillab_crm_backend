import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Holiday } from 'src/schema/holiday.schema';

export class HolidayData {
  constructor(
    @InjectModel(Holiday.name)
    private readonly model: Model<Holiday>,
  ) {}

  create(data: any) {
    return this.model.create(data);
  }

findAll(filters: any = {}) {
  const query: any = {};

  if (filters.isActive !== undefined) {
    query.isActive =
      filters.isActive === true ||
      filters.isActive === 'true';
  }

  const hasMonth = filters.month !== undefined;
  const hasYear = filters.year !== undefined;

  if (hasMonth || hasYear) {
    const now = new Date();

    const year = hasYear
      ? Number(filters.year)
      : now.getFullYear();

    // month = 1-12 from API
    const month = hasMonth
      ? Number(filters.month) - 1
      : undefined;

    if (Number.isNaN(year)) {
      throw new Error('Invalid year');
    }

    if (month !== undefined && (month < 0 || month > 11)) {
      throw new Error('Month must be between 1 and 12');
    }

    let startDate: Date;
    let endDate: Date;

    if (month !== undefined) {
      // Specific month + year
      startDate = new Date(year, month, 1);
      endDate = new Date(year, month + 1, 1);
    } else {
      // Complete year
      startDate = new Date(year, 0, 1);
      endDate = new Date(year + 1, 0, 1);
    }

    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(0, 0, 0, 0);

    query.date = {
      $gte: startDate,
      $lt: endDate,
    };
  }

  return this.model
    .find(query)
    .sort({ date: 1 });
}

  findById(id: string) {
    return this.model.findById(id);
  }

  findByDate(date: Date) {
    return this.model.findOne({
      date,
      isActive: true,
    });
  }

  update(id: string, data: any) {
    return this.model.findByIdAndUpdate(
      id,
      data,
      {
        new: true,
        runValidators: true,
      },
    );
  }

  delete(id: string) {
    return this.model.findByIdAndDelete(id);
  }
}