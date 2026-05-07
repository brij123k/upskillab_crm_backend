import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Announcement } from 'src/schema/announcement.schema';

export class AnnouncementData {
  constructor(
    @InjectModel(Announcement.name)
    private readonly model: Model<Announcement>,
  ) {}

  create(data: any) {
    return this.model.create(data);
  }

  findById(id: string) {
    return this.model.findById(id);
  }

 async findAll(filters: any = {}) {
    const query: any = {};

  // 🔹 Audience filter
  if (filters.audience) {
    query.audience = filters.audience;
  }

  // 🔹 Department filter
  if (filters.departmentId) {
    query.departmentId = new Types.ObjectId(filters.departmentId);
  }

  // 🔹 Created By
  if (filters.createdBy) {
    query.createdBy = new Types.ObjectId(filters.createdBy);
  }

  // 🔹 Specific user (for selected users or recipients)
  if (filters.userId) {
    query.$or = [
      { userIds: new Types.ObjectId(filters.userId) },
      { recipientUserIds: new Types.ObjectId(filters.userId) },
    ];
  }

  // 🔹 Search (title + message)
  if (filters.search) {
    query.$or = [
      { title: { $regex: filters.search, $options: 'i' } },
      { message: { $regex: filters.search, $options: 'i' } },
    ];
  }

  // 🔥 Date filter (same-day fix included)
  if (filters.fromDate || filters.toDate) {
    query.createdAt = {};

    if (filters.fromDate && filters.toDate) {
      const from = new Date(filters.fromDate);
      const to = new Date(filters.toDate);

      from.setHours(0, 0, 0, 0);
      to.setHours(23, 59, 59, 999);

      query.createdAt.$gte = from;
      query.createdAt.$lte = to;
    } else {
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
  }

  // 🔹 Pagination
  const page = Number(filters.page) || 1;
  const limit = Number(filters.limit) || 10;
  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    this.model
      .find(query)
      .populate('createdBy', 'name email employeeId')
      .populate('departmentId', 'name')
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
  }
}
}
