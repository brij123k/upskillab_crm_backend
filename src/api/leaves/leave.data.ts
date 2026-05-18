import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { LeaveRequest, LeaveStatus } from 'src/schema/leave.schema';

export class LeaveData {
  constructor(
    @InjectModel(LeaveRequest.name)
    private readonly model: Model<LeaveRequest>,
  ) {}

  create(data: any) {
    return this.model.create(data);
  }

  createMany(data: any[]) {
    return this.model.insertMany(data);
  }

  findById(id: string) {
    return this.model
      .findById(id)
      .populate('userId', 'name email employeeId role')
      .populate('createdBy', 'name email employeeId role')
      .populate('reportToUserId', 'name email employeeId role')
      .populate('reportToUserIds', 'name email employeeId role')
      .populate('approvedBy', 'name email employeeId role');
  }

  findByUserAndId(userId: string, id: string) {
    return this.model
      .findOne({ _id: id, userId: new Types.ObjectId(userId) })
      .populate('userId', 'name email employeeId role')
      .populate('createdBy', 'name email employeeId role')
      .populate('reportToUserId', 'name email employeeId role')
      .populate('reportToUserIds', 'name email employeeId role')
      .populate('approvedBy', 'name email employeeId role');
  }

  findByApproverAndId(approverId: string, id: string) {
    return this.model
      .findOne({
        _id: id,
        $or: [
          { reportToUserId: new Types.ObjectId(approverId) },
          { reportToUserIds: new Types.ObjectId(approverId) },
        ],
      })
      .populate('userId', 'name email employeeId role')
      .populate('createdBy', 'name email employeeId role')
      .populate('reportToUserId', 'name email employeeId role')
      .populate('reportToUserIds', 'name email employeeId role')
      .populate('approvedBy', 'name email employeeId role');
  }

  update(id: string, data: any) {
    return this.model
      .findByIdAndUpdate(id, data, { new: true, runValidators: true })
      .populate('userId', 'name email employeeId role')
      .populate('createdBy', 'name email employeeId role')
      .populate('reportToUserId', 'name email employeeId role')
      .populate('reportToUserIds', 'name email employeeId role')
      .populate('approvedBy', 'name email employeeId role');
  }

  delete(id: string) {
    return this.model.findByIdAndDelete(id);
  }

  async findAll(filters: any = {}) {
    const query: any = {};

    if (filters.userId) query.userId = new Types.ObjectId(filters.userId);
    if (filters.reportToUserId) {
      query.$or = [
        ...(query.$or || []),
        { reportToUserId: new Types.ObjectId(filters.reportToUserId) },
        { reportToUserIds: new Types.ObjectId(filters.reportToUserId) },
      ];
    }
    if (filters.createdBy) query.createdBy = new Types.ObjectId(filters.createdBy);
    if (filters.status) query.status = filters.status;

    if (filters.fromDate || filters.toDate) {
      const from = filters.fromDate ? new Date(filters.fromDate) : new Date('1970-01-01');
      const to = filters.toDate ? new Date(filters.toDate) : new Date('2999-12-31');
      from.setHours(0, 0, 0, 0);
      to.setHours(23, 59, 59, 999);
      query.$or = [
        { leaveFrom: { $lte: to }, leaveTo: { $gte: from } },
        { leaveDate: { $gte: from, $lte: to } },
      ];
    }

    const page = Number(filters.page) || 1;
    const limit = Number(filters.limit) || 10;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.model
        .find(query)
        .populate('userId', 'name email employeeId role')
        .populate('createdBy', 'name email employeeId role')
        .populate('reportToUserId', 'name email employeeId role')
        .populate('reportToUserIds', 'name email employeeId role')
        .populate('approvedBy', 'name email employeeId role')
        .sort({ leaveDate: -1, createdAt: -1 })
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
      userId,
    });
  }

  findAllByApprover(approverId: string, filters: any = {}) {
    return this.findAll({
      ...filters,
      reportToUserId: approverId,
    });
  }

  async countMonthlyByUser(userId: string, date = new Date(), excludeId?: string) {
    const start = new Date(date);
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);
    end.setDate(0);
    end.setHours(23, 59, 59, 999);

    const query: any = {
      userId: new Types.ObjectId(userId),
      leaveDate: { $gte: start, $lte: end },
      status: { $in: [LeaveStatus.PENDING, LeaveStatus.APPROVED] },
    };

    if (excludeId) {
      query._id = { $ne: new Types.ObjectId(excludeId) };
    }

    return this.model.countDocuments(query);
  }

  async findMonthlyByUser(userId: string, start: Date, end: Date, excludeId?: string) {
    const query: any = {
      userId: new Types.ObjectId(userId),
      status: { $in: [LeaveStatus.PENDING, LeaveStatus.APPROVED] },
      $or: [
        { leaveFrom: { $lte: end }, leaveTo: { $gte: start } },
        { leaveDate: { $gte: start, $lte: end } },
      ],
    };

    if (excludeId) {
      query._id = { $ne: new Types.ObjectId(excludeId) };
    }

    return this.model.find(query).select('leaveFrom leaveTo leaveDate status').lean();
  }
}
