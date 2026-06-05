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

  findAll() {
    return this.model.find().populate('roleId', 'name level isSuperAdmin').sort({ createdAt: -1 });
  }

  findById(id: string) {
    return this.model.findById(id).populate('roleId', 'name level isSuperAdmin');
  }

  findByRoleId(roleId: string) {
    return this.model.findOne({ roleId: new Types.ObjectId(roleId) }).populate('roleId', 'name level isSuperAdmin');
  }

  update(id: string, data: any) {
    return this.model.findByIdAndUpdate(id, data, { new: true, runValidators: true }).populate('roleId', 'name level isSuperAdmin');
  }

  delete(id: string) {
    return this.model.findByIdAndDelete(id);
  }
}
