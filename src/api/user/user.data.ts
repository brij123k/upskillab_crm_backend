import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Profile } from 'src/schema/profile.schema';
import { User } from 'src/schema/user.schema';
export class UserData {
  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<User>,

    @InjectModel(Profile.name)
    private readonly profileModel: Model<Profile>,
  ) {}

  create(data: any) {
    return this.userModel.create(data);
  }

  findByEmail(email: string) {
    return this.userModel.findOne({ email }).populate('role');
  }
  findByEmailWithRole(email: string) {
  return this.userModel
    .findOne({ email })
    .populate('role');
}
  findById(id: string) {
  return this.userModel.findById(id).populate('role');
}
async findbyEmpId(employeeId: number) {
  return this.userModel.aggregate([
    {
      $addFields: {
        employeeIdStr: { $toString: '$employeeId' },
      },
    },
    {
      $match: {
        employeeIdStr: {
          $regex: employeeId.toString(),
        },
      },
    },
    {
      $project: {
        _id: 1,
      },
    },
  ]);
}


findByIds(userIds: string[]) {
  return this.userModel
    .find(
      { _id: { $in: userIds } },
      { name: 1, email: 1, number: 1, role: 1, employeeId: 1 },
    )
    .select(
        'name email number employeeId status isBlocked isDashboardEnabled IVREnabled role lastLoginAt createdAt updatedAt',
      )
    .populate({
        path: 'role',
        select: 'name isSuperAdmin permissions',
      })
    .lean();
}
findUserDepartmentById(id: string) {
  return this.userModel
    .findById(id)
    .select('departmentId');
}

async findByEmployeeId(employeeId: number) {
  return this.userModel.findOne({ employeeId });
}

  update(id: any, data: any) {
    console.log(id,data)
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
        'name email number employeeId status isBlocked isDashboardEnabled IVREnabled role lastLoginAt createdAt updatedAt',
      )
      .populate({
        path: 'role',
        select: 'name isSuperAdmin permissions',
      })
      .lean();
  }

  async findAllSubordinates(
  seniorUserId: string,
  departmentId: string,
) {
  const result: any[] = [];
  const stack = [seniorUserId];
  while (stack.length) {
    const currentSenior = stack.pop();
    const juniors = await this.profileModel.find({
      reportingSeniorId: new Types.ObjectId(currentSenior),
      departmentId: new Types.ObjectId(departmentId),
    });

    for (const junior of juniors) {
      result.push(junior);
      stack.push(junior.userId.toString());
    }
  }

  return result;
}


}
