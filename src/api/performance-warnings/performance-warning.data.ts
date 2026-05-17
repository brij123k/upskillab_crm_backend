import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PerformanceWarning } from 'src/schema/performance-warning.schema';

export class PerformanceWarningData {
  constructor(
    @InjectModel(PerformanceWarning.name)
    private readonly model: Model<PerformanceWarning>,
  ) {}

  create(data: any) {
    return this.model.create(data);
  }

  findById(id: string) {
    return this.model
      .findById(id)
      .populate('userId', 'name email employeeId')
      .populate('issuedBy', 'name email employeeId');
  }

  findByUserAndId(userId: string, id: string) {
    return this.model
      .findOne({
        _id: new Types.ObjectId(id),
        userId: new Types.ObjectId(userId),
      })
      .populate('userId', 'name email employeeId')
      .populate('issuedBy', 'name email employeeId');
  }

  async findAll(filters: any = {}) {
  const query: any = {};

  // 🔹 Filters
  if (filters.userId) {
    query.userId = new Types.ObjectId(filters.userId);
  }

  if (filters.issuedBy) {
    query.issuedBy = new Types.ObjectId(filters.issuedBy);
  }

  if (filters.type) {
    query.type = filters.type;
  }

  // 🔥 Date filter (full-day safe)
  if (filters.fromDate || filters.toDate) {
    query.createdAt = {};

    if (filters.fromDate) {
      const from = new Date(filters.fromDate);
      from.setHours(0, 0, 0, 0);
      query.createdAt.$gte = from;
    }

    if (filters.toDate) {
      const to = new Date(filters.toDate);
      to.setHours(23, 59, 59, 999);
      query.createdAt.$lte = to;
    }
  }

  // 🔹 Pagination
  const page = Number(filters.page) || 1;
  const limit = Number(filters.limit) || 10;
  const skip = (page - 1) * limit;

  // 🔹 Execute in parallel
  const [data, total] = await Promise.all([
    this.model
      .find(query)
      .populate('userId', 'name email employeeId')
      .populate('issuedBy', 'name email employeeId')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),

    this.model.countDocuments(query),
  ]);

  return {
    data,
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
}
}
