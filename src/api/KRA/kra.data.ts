import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Kra } from 'src/schema/kra.schema';

export class KraData {
  constructor(
    @InjectModel(Kra.name)
    private readonly model: Model<Kra>,
  ) {}

  create(data: any) {
    return this.model.create(data);
  }

  findAll() {
    return this.model.find().populate('roleId', 'name').sort({ createdAt: -1 });
  }

  findById(id: string) {
    return this.model.findById(id).populate('roleId', 'name');
  }

  findByRoleId(roleId: string) {
    return this.model.findOne({roleId}).populate('roleId', 'name');
  }

  upsertByRoleId(roleId: string, data: any) {
    return this.model.findOneAndUpdate(
      { roleId: new Types.ObjectId(roleId) },
      { $set: { ...data, roleId: new Types.ObjectId(roleId) } },
      { new: true, upsert: true, runValidators: true },
    ).populate('roleId', 'name');
  }

  update(id: string, data: any) {
    return this.model.findByIdAndUpdate(id, data, { new: true, runValidators: true }).populate('roleId', 'name');
  }

  delete(id: string) {
    return this.model.findByIdAndDelete(id);
  }
}
