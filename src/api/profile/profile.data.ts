import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Profile } from 'src/schema/profile.schema';


export class ProfileData {
  constructor(
    @InjectModel(Profile.name)
    private readonly profileModel: Model<Profile>,
  ) {}

  create(data: any) {
    return this.profileModel.create(data);
  }

findAll() {
  return this.profileModel
    .find()
    .populate({
      path: 'userId',
      select:
        'name email number status isBlocked lastLoginAt isDashboardEnabled role createdAt updatedAt',
      populate: {
        path: 'role',
        select: 'name isSuperAdmin permissions',
      },
    })
    .populate('departmentId', 'name')
    .populate('reportingSenierId', 'name');
}

findByUserIds(userIds: string[]) {
  return this.profileModel
    .find({ userId: { $in: userIds } })
    .populate('departmentId', 'name')
    .populate('reportingSenierId', 'name')
    .lean();
}



  findById(id: string) {
    return this.profileModel.findById(id);
  }

  findByUserId(userId: string) {
    return this.profileModel.findOne({ userId:new Types.ObjectId(userId) });
  }

getBydepartmentId(departmentId: string) {
    return this.profileModel.findOne({ departmentId:new Types.ObjectId(departmentId) });
  }

  updateById(id: string, data: any) {
    return this.profileModel.findByIdAndUpdate(id, data, { new: true });
  }

  updateByUserId(userId: string, data: any) {
    console.log(userId,data)
    return this.profileModel.findOneAndUpdate(
      {userId: new Types.ObjectId(userId) },
      data,
      { new: true },
    );
  }

  deleteById(id: string) {
    return this.profileModel.findByIdAndDelete(id);
  }

  deleteByUserId(userId: string) {
    return this.profileModel.findOneAndDelete({ userId });
  }
}
