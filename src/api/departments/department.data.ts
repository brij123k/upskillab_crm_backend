import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Department } from 'src/schema/department.schema';

export class DepartmentData {
  constructor(
    @InjectModel(Department.name)
    private readonly departmentModel: Model<Department>,
  ) {}

  create(data: any) {
    return this.departmentModel.create(data);
  }

  findAll() {
    return this.departmentModel
      .find()
      .populate('parentDepartmentId', 'name');
  }

  findById(id: string) {
    return this.departmentModel
      .findById(id)
      .populate('parentDepartmentId', 'name');
  }

  update(id: string, data: any) {
    return this.departmentModel.findByIdAndUpdate(id, data, {
      new: true,
    });
  }

  delete(id: string) {
    return this.departmentModel.findByIdAndDelete(id);
  }

  findByName(name: string) {
    return this.departmentModel.findOne({ name });
  }
}
