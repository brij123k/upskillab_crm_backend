import { buildDateCondition, containsRegex } from 'src/common/utils/filter.util';
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

  findByUserAndId(userId: string, id: string) {
    return this.model
      .findOne({ _id: id, assignTo: new Types.ObjectId(userId) })
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

  // 🔍 search title / description
  if (filters.search && String(filters.search).trim()) {
    query.$or = [
      { title: containsRegex(filters.search) },
      { description: containsRegex(filters.search) },
    ];
  }

  // 📅 due date & created date ranges ("to" is inclusive, either side optional)
  const due = buildDateCondition(undefined, filters.fromDate, filters.toDate);
  if (due) query.dueDate = due;
  const created = buildDateCondition(undefined, filters.createdFromDate, filters.createdToDate);
  if (created) query.createdAt = created;

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
