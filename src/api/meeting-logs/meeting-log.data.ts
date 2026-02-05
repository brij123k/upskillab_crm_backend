import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import { MeetingFeedback } from 'src/schema/meeting-feedback.schema';
import { MeetingLog } from 'src/schema/meeting-log.schema';

export class MeetingLogData {
  constructor(
    @InjectModel(MeetingLog.name)
    private meetingModel: Model<MeetingLog>,

    @InjectModel(MeetingFeedback.name)
    private feedbackModel: Model<MeetingFeedback>,
  ) {}

  create(data: Partial<MeetingLog>) {
    return this.meetingModel.create(data);
  }

  update(id: string, data: any) {
    return this.meetingModel.findByIdAndUpdate(id, data, { new: true });
  }

  delete(id: string) {
    return this.meetingModel.findByIdAndDelete(id);
  }

  findByLeadId(leadId: number) {
    return this.meetingModel
      .find({ leadId })
      .populate('userId', 'name email')
      .populate('stageId', 'name')
      .sort({ startedAt: -1 });
  }

  findByUser(userId?: string) {
    const query = userId ? { userId } : {};
    return this.meetingModel
      .find(query)
      .populate('userId', 'name email')
      .populate('stageId', 'name')
      .sort({ startedAt: -1 });
  }

  async meetingsWithFeedbacks() {
    const pipeline: PipelineStage[] = [
      {
        $lookup: {
          from: 'meetingfeedbacks',
          localField: '_id',
          foreignField: 'meetingId',
          as: 'feedbacks',
        },
      },
    ];

    return this.meetingModel.aggregate(pipeline);
  }
}
