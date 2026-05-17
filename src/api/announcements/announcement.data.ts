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

  findByUserAndId(userId: string, id: string) {
    return this.model
      .findOne({
        _id: new Types.ObjectId(id),
        $or: [
          { createdBy: new Types.ObjectId(userId) },
          { recipientUserIds: new Types.ObjectId(userId) },
        ],
      })
      .populate('createdBy', 'name email employeeId')
      .populate('departmentId', 'name');
  }

  async findAll(filters: any = {}) {
    const query: any = {};
    const andConditions: any[] = [];

    if (filters.audience) {
      query.audience = filters.audience;
    }

    if (filters.departmentId) {
      query.departmentId = new Types.ObjectId(filters.departmentId);
    }

    if (filters.createdBy) {
      query.createdBy = new Types.ObjectId(filters.createdBy);
    }

    if (filters.userId) {
      andConditions.push({
        $or: [
        { userIds: new Types.ObjectId(filters.userId) },
        { recipientUserIds: new Types.ObjectId(filters.userId) },
        ],
      });
    }

    if (filters.search) {
      andConditions.push({
        $or: [
        { title: { $regex: filters.search, $options: 'i' } },
        { message: { $regex: filters.search, $options: 'i' } },
        ],
      });
    }

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

    if (andConditions.length > 0) {
      query.$and = andConditions;
    }

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
    };
  }

  async findForUser(userId: string, filters: any = {}) {
    const query: any = {
      recipientUserIds: new Types.ObjectId(userId),
    };
    const andConditions: any[] = [];

    if (filters.search) {
      andConditions.push({
        $or: [
        { title: { $regex: filters.search, $options: 'i' } },
        { message: { $regex: filters.search, $options: 'i' } },
        ],
      });
    }

    if (filters.audience) {
      query.audience = filters.audience;
    }

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

    if (andConditions.length > 0) {
      query.$and = andConditions;
    }

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
    };
  }
}
