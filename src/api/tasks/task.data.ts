import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Task } from 'src/schema/task.schema';

export class TaskData {
  constructor(
    @InjectModel(Task.name)
    private readonly model: Model<Task>,
  ) {}

  create(data: any) {
    return this.model.create(data);
  }

  findById(id: string) {
    return this.model
      .findById(id)
      .populate('assignTo', 'name email employeeId')
      .populate('assignedBy', 'name email employeeId');
  }

  update(id: string, data: any) {
    return this.model
      .findByIdAndUpdate(id, data, { new: true })
      .populate('assignTo', 'name email employeeId')
      .populate('assignedBy', 'name email employeeId');
  }

  delete(id: string) {
    return this.model.findByIdAndDelete(id);
  }

async findAll(filters: any = {}) {
  const query: any = {};

  // Filters
  if (filters.assignTo) query.assignTo = new Types.ObjectId(filters.assignTo);
  if (filters.assignedBy) query.assignedBy = new Types.ObjectId(filters.assignedBy);
  if (filters.status) query.status = filters.status;
  if (filters.reletedLeadId) query.reletedLeadIds = Number(filters.reletedLeadId);

  // 🔥 FIXED: dueDate filter
  if (filters.fromDate || filters.toDate) {
    query.dueDate = {};

    if (filters.fromDate && filters.toDate) {
      const from = new Date(filters.fromDate);
      const to = new Date(filters.toDate);

      // ✅ Same date → full day range
      if (from.toDateString() === to.toDateString()) {
        from.setHours(0, 0, 0, 0);
        to.setHours(23, 59, 59, 999);
      }

      query.dueDate.$gte = from;
      query.dueDate.$lte = to;
    } else {
      if (filters.fromDate) {
        const from = new Date(filters.fromDate);
        from.setHours(0, 0, 0, 0);
        query.dueDate.$gte = from;
      }

      if (filters.toDate) {
        const to = new Date(filters.toDate);
        to.setHours(23, 59, 59, 999);
        query.dueDate.$lte = to;
      }
    }
  }

  // 🔥 SAME FIX for createdAt
  if (filters.createdFromDate || filters.createdToDate) {
    query.createdAt = {};

    if (filters.createdFromDate && filters.createdToDate) {
      const from = new Date(filters.createdFromDate);
      const to = new Date(filters.createdToDate);

      if (from.toDateString() === to.toDateString()) {
        from.setHours(0, 0, 0, 0);
        to.setHours(23, 59, 59, 999);
      }

      query.createdAt.$gte = from;
      query.createdAt.$lte = to;
    } else {
      if (filters.createdFromDate) {
        const from = new Date(filters.createdFromDate);
        from.setHours(0, 0, 0, 0);
        query.createdAt.$gte = from;
      }

      if (filters.createdToDate) {
        const to = new Date(filters.createdToDate);
        to.setHours(23, 59, 59, 999);
        query.createdAt.$lte = to;
      }
    }
  }

  // Pagination
  const page = Number(filters.page) || 1;
  const limit = Number(filters.limit) || 10;
  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    this.model
      .find(query)
      .populate('assignTo', 'name email employeeId')
      .populate('assignedBy', 'name email employeeId')
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

  findAllByUser(userId: string, filters: any = {}) {
    return this.findAll({
      ...filters,
      assignTo: userId,
    });
  }
}
