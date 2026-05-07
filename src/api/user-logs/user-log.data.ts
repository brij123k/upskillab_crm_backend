import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { UserLog } from 'src/schema/user-log.schema';

export class UserLogData {
  constructor(
    @InjectModel(UserLog.name)
    private readonly model: Model<UserLog>,
  ) {}

  create(data: any) {
    return this.model.create(data);
  }

  findByUser(userId: string) {
    return this.model
      .find({ userId: new Types.ObjectId(userId) })
      .populate('userId', 'name email employeeId')
      .sort({ createdAt: -1 });
  }

  findAll(filter: any = {}) {
    return this.model
      .find(filter)
      .populate('userId', 'name email employeeId')
      .sort({ createdAt: -1 });
  }
}
