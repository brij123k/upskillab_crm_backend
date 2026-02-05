import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { MeetingFeedback } from 'src/schema/meeting-feedback.schema';

export class MeetingFeedbackLogData {
  constructor(
    @InjectModel(MeetingFeedback.name)
    private feedbackModel: Model<MeetingFeedback>,
  ) {}

  create(data: Partial<MeetingFeedback>) {
    return this.feedbackModel.create(data);
  }

}
