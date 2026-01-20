import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from 'src/schema/user.schema';
export class UserData {
  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<User>
  ) {}

  create(data: any) {
    return this.userModel.create(data);
  }

  findByEmail(email: string) {
    return this.userModel.findOne({ email }).populate('role');
  }
  findById(id: string) {
  return this.userModel.findById(id);
}
findUserDepartmentById(id: string) {
  return this.userModel
    .findById(id)
    .select('departmentId');
}

  update(id: any, data: any) {
    return this.userModel.findByIdAndUpdate(id, data, { new: true });
  }

  updateStatus(userId: string, status: string) {
  return this.userModel.findByIdAndUpdate(
    userId,
    { status },
    { new: true },
  );
}

toggleBlock(userId: string, isBlocked: boolean) {
  return this.userModel.findByIdAndUpdate(
    userId,
    { isBlocked },
    { new: true },
  );
}

  async getAllUsers() {
    return this.userModel
      .find()
      .select(
        'name email number status isBlocked isDashboardEnabled role lastLoginAt createdAt updatedAt',
      )
      .populate({
        path: 'role',
        select: 'name isSuperAdmin permissions',
      })
      .lean();
  }


}
