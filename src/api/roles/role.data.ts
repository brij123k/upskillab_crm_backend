import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Role } from 'src/schema/role.schema';

export class RoleData {
  constructor(
    @InjectModel(Role.name)
    private readonly roleModel: Model<Role>,
  ) {}

  create(data: any) {
    return this.roleModel.create(data);
  }

  findAll() {
    return this.roleModel.find().sort({ level: -1, name: 1 });
  }

  findById(id: string) {
    return this.roleModel.findById(id);
  }

  update(id: string, data: any) {
    return this.roleModel.findByIdAndUpdate(id, data, { new: true });
  }

  delete(id: string) {
    return this.roleModel.findByIdAndDelete(id);
  }
  findByName(name: string) {
  return this.roleModel.findOne({ name });
}
}
