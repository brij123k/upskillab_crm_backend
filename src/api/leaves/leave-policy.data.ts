import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { LeavePolicy } from 'src/schema/leave-policy.schema';

export class LeavePolicyData {
  constructor(
    @InjectModel(LeavePolicy.name)
    private readonly model: Model<LeavePolicy>,
  ) {}

  create(data: any) {
    return this.model.create(data);
  }

  createMany(data: any[]) {
    return this.model.insertMany(data);
  }

  findAll(filters: any = {}) {
    const query: any = {};

    if (filters.roleId) {
      query.roleId = new Types.ObjectId(filters.roleId);
    }

    if (filters.year) {
      query.year = Number(filters.year);
    }

    if (filters.isActive !== undefined) {
      query.isActive = filters.isActive;
    }

    return this.model
      .find(query)
      .populate('roleId', 'name level isSuperAdmin')
      .sort({
        year: -1,
        createdAt: -1,
      });
  }

  findById(id: string) {
    return this.model
      .findById(id)
      .populate('roleId', 'name level isSuperAdmin');
  }

  findByRoleAndYear(
    roleId: string,
    year: number,
  ) {
    return this.model
      .findOne({
        roleId: new Types.ObjectId(roleId),
        year,
      })
      .populate('roleId', 'name level isSuperAdmin');
  }

  findActivePolicy(
    roleId: string,
    year: number,
  ) {
    return this.model
      .findOne({
        roleId: new Types.ObjectId(roleId),
        year,
        isActive: true,
      })
      .populate('roleId', 'name level isSuperAdmin');
  }

  findByYear(year: number) {
    return this.model
      .find({
        year,
      })
      .populate('roleId', 'name level isSuperAdmin')
      .sort({
        createdAt: -1,
      });
  }

  update(
    id: string,
    data: any,
  ) {
    return this.model
      .findByIdAndUpdate(
        id,
        data,
        {
          new: true,
          runValidators: true,
        },
      )
      .populate('roleId', 'name level isSuperAdmin');
  }

  delete(id: string) {
    return this.model.findByIdAndDelete(id);
  }

  exists(
    roleId: string,
    year: number,
  ) {
    return this.model.exists({
      roleId: new Types.ObjectId(roleId),
      year,
    });
  }

  activate(
    id: string,
  ) {
    return this.model.findByIdAndUpdate(
      id,
      {
        isActive: true,
      },
      {
        new: true,
      },
    );
  }

  deactivate(
    id: string,
  ) {
    return this.model.findByIdAndUpdate(
      id,
      {
        isActive: false,
      },
      {
        new: true,
      },
    );
  }
}