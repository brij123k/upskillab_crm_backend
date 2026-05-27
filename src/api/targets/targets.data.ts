import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Target } from 'src/schema/target.schema';

export class TargetsData {
  constructor(
    @InjectModel(Target.name)
    private readonly targetModel: Model<Target>,
  ) {}

  findByMonth(monthKey: string) {
    return this.targetModel
      .find({ monthKey })
      .populate({
        path: 'userId',
        select: 'name email employeeId status role createdAt',
        populate: { path: 'role', select: 'name level isSuperAdmin' },
      })
      .lean();
  }

  findByUserAndMonth(userId: string, monthKey: string) {
    return this.targetModel
      .findOne({
        userId: new Types.ObjectId(userId),
        monthKey,
      })
      .lean();
  }

  findByUserId(userId: string) {
    return this.targetModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ monthKey: -1 })
      .lean();
  }

  findById(id: string) {
    return this.targetModel.findById(id).lean();
  }

  create(data: any) {
    return this.targetModel.create(data);
  }

  updateById(id: string, data: any) {
    return this.targetModel.findByIdAndUpdate(id, data, { new: true }).lean();
  }

  upsertByUserAndMonth(userId: string, monthKey: string, data: any) {
    return this.targetModel.findOneAndUpdate(
      { userId: new Types.ObjectId(userId), monthKey },
      { $set: data, $setOnInsert: { userId: new Types.ObjectId(userId), monthKey } },
      { new: true, upsert: true },
    ).lean();
  }

  upsertMany(rows: any[]) {
    return Promise.all(rows.map((row) => this.upsertByUserAndMonth(row.userId, row.monthKey, row)));
  }
}
