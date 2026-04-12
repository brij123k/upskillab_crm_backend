import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LeadStage } from 'src/schema/lead_management/lead-stage.schema';

export class LeadStageData {
  constructor(
    @InjectModel(LeadStage.name)
    private readonly leadStageModel: Model<LeadStage>,
  ) {}

  create(data: any) {
    return this.leadStageModel.create(data);
  }

  findAll() {
    return this.leadStageModel
      .find()
      .populate('departmentId', 'name')
      .sort({ order: 1 });
  }

  findById(id: string) {
    return this.leadStageModel.findById(id);
  }

  update(id: string, data: any) {
    return this.leadStageModel.findByIdAndUpdate(id, data, {
      new: true,
    });
  }

  delete(id: string) {
    return this.leadStageModel.findByIdAndDelete(id);
  }

  findByNameAndDepartment(name: string) {
    return this.leadStageModel.findOne({ name});
  }
}
