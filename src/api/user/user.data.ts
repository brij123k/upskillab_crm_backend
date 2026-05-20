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

  private buildStatusFilter(status?: string | string[]) {
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

    if (!statusList.length) {
      return { $in: ['active'] };
    }

    return { $in: statusList };
  }

  private applyStatusFilter(query: any, status?: string | string[]) {
    const statusFilter = this.buildStatusFilter(status);
    if (statusFilter) {
      query.status = statusFilter;
    }
    return query;
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


findByIds(userIds: string[], status?: string | string[]) {
  const query: any = { _id: { $in: userIds } };
  this.applyStatusFilter(query, status);

  return this.userModel
    .find(
      query,
      { name: 1, email: 1, number: 1, role: 1, employeeId: 1 },
    )
    .select(
        'name email number employeeId status isBlocked isDashboardEnabled IVREnabled role lastLoginAt createdAt updatedAt',
      )
    .populate({
        path: 'role',
        select: 'name level isSuperAdmin permissions',
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

  async getAllUsers(status?: string | string[]) {
    const query: any = {};
    this.applyStatusFilter(query, status);

    return this.userModel
      .find(query)
      .select(
        'name email number employeeId status isBlocked isDashboardEnabled IVREnabled role lastLoginAt createdAt updatedAt',
      )
    .populate({
        path: 'role',
        select: 'name level isSuperAdmin permissions',
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
