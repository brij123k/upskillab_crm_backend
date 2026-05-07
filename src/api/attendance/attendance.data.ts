import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Attendance } from 'src/schema/attendance.schema';

export class AttendanceData {
  constructor(
    @InjectModel(Attendance.name)
    private readonly model: Model<Attendance>,
  ) {}

  create(data: any) {
    return this.model.create(data);
  }

  findById(id: string) {
    return this.model
      .findById(id)
      .populate('userId', 'name email employeeId');
  }

  findByUserAndDate(userId: string, date: Date) {
    return this.model.findOne({
      userId: new Types.ObjectId(userId),
      date,
    });
  }

  findByUser(userId: string, filters: any = {}) {
  const query: any = {
    userId: new Types.ObjectId(userId),
  };

  // 🔥 Month filter (default = current month)
  const now = new Date();

  const month = filters.month
    ? Number(filters.month) - 1 // JS months are 0-based
    : now.getMonth();

  const year = filters.year
    ? Number(filters.year)
    : now.getFullYear();

  // Start of month
  const startDate = new Date(year, month, 1);
  startDate.setHours(0, 0, 0, 0);

  // End of month
  const endDate = new Date(year, month + 1, 0);
  endDate.setHours(23, 59, 59, 999);

  query.date = {
    $gte: startDate,
    $lte: endDate,
  };

  return this.model
    .find(query)
    .populate('userId', 'name email employeeId')
    .sort({ date: -1, loginTime: -1 });
}

  findAll(filters: any = {}) {
    const query: any = {};

    if (filters.userId) query.userId = new Types.ObjectId(filters.userId);
    if (filters.status) query.status = filters.status;
    if (filters.fromDate || filters.toDate) {
      query.date = {};
      if (filters.fromDate) query.date.$gte = new Date(filters.fromDate);
      if (filters.toDate) query.date.$lte = new Date(filters.toDate);
    }

    return this.model
      .find(query)
      .populate('userId', 'name email employeeId')
      .sort({ date: -1, loginTime: -1 });
  }

  update(id: string, data: any) {
    return this.model
      .findByIdAndUpdate(id, data, { new: true })
      .populate('userId', 'name email employeeId');
  }

  delete(id: string) {
    return this.model.findByIdAndDelete(id);
  }

  upsert(userId: string, date: Date, data: any) {
    return this.model.findOneAndUpdate(
      { userId: new Types.ObjectId(userId), date },
      { $set: data },
      { new: true, upsert: true },
    ).populate('userId', 'name email employeeId');
  }
}
