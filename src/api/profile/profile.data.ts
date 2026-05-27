import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Profile } from 'src/schema/profile.schema';


export class ProfileData {
  constructor(
    @InjectModel(Profile.name)
    private readonly profileModel: Model<Profile>,
  ) {}

  private buildUserStatusMatch(status?: string | string[]) {
    if (!status || status === 'all') {
      return null;
    }

    if (Array.isArray(status)) {
      return { $in: status };
    }

    const statusList = status
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

    return { $in: statusList.length ? statusList : ['active'] };
  }

  create(data: any) {
    return this.profileModel.create(data);
  }

findAll() {
  return this.profileModel
    .find()
      .populate({
      path: 'userId',
      select:
        'name email number employeeId status isBlocked lastLoginAt isDashboardEnabled role createdAt updatedAt',
      populate: {
        path: 'role',
        select: 'name level isSuperAdmin permissions',
      },
    })
    .populate('departmentId', 'name')
    .populate('reportingSeniorId', 'name')
    .populate('poolIds', 'name');
}

findByUserIds(userIds: string[]) {
  return this.profileModel
    .find({ userId: { $in: userIds } })
    .populate('departmentId', 'name')
    .populate('reportingSeniorId', 'name')
    .populate('poolIds', 'name')
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

getBydepId(departmentId: string, status?: string | string[]) {
  return this.profileModel
    .find({ departmentId: new Types.ObjectId(departmentId) })
    .populate({
      path: 'userId',
      ...(this.buildUserStatusMatch(status)
        ? { match: { status: this.buildUserStatusMatch(status) } }
        : {}),
      populate: {
        path: 'role',   // field inside User schema
        model: 'Role',  // role model name
      },
    })
    .populate('poolIds', 'name');

}


  updateById(id: string, data: any) {
    return this.profileModel.findByIdAndUpdate(id, data, { new: true });
  }

  updateByUserId(userId: string, data: any) {
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
