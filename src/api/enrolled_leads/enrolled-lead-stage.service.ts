import {
  BadRequestException,
  Injectable,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  DEFAULT_ENROLLED_STAGE,
  EnrolledLeadStage,
} from 'src/schema/enrolled_leads/enrolled-lead-meta.schema';
import { EnrolledLead } from 'src/schema/enrolled_leads/enrolled-lead.schema';
import {
  EnrolledStageDto,
  UpdateEnrolledStageDto,
} from 'src/dto/enrolled_leads/enrolled-lead.dto';

/**
 * Fixed (static) enrolled-lead stages: "Enrolled" for new students plus the
 * learner feedback outcomes. Synced on every start – any other stage is
 * deactivated and its students are moved back to "Enrolled".
 */
export const STATIC_ENROLLED_STAGES: { name: string; color: string; description: string; isDefault?: boolean }[] = [
  { name: DEFAULT_ENROLLED_STAGE, color: '#f97316', description: 'Newly enrolled student – no feedback recorded yet.', isDefault: true },
  { name: 'Learner Satisfied', color: '#16a34a', description: 'Happy with the overall experience.' },
  { name: 'Learner Partially Satisfied', color: '#84cc16', description: 'Has some concerns but is generally satisfied.' },
  { name: 'Learner Dissatisfied', color: '#dc2626', description: 'Not satisfied with the experience.' },
  { name: 'Issue Resolved', color: '#0d9488', description: 'Previously reported issue has been resolved.' },
  { name: 'Issue Pending', color: '#f59e0b', description: 'Issue reported and resolution is awaited.' },
  { name: 'Follow-up Required', color: '#3b82f6', description: 'Further communication is needed.' },
  { name: 'Escalation Required', color: '#b91c1c', description: 'Requires intervention from management.' },
  { name: 'Callback Scheduled', color: '#8b5cf6', description: 'Learner has requested another call.' },
  { name: 'No Further Action Required', color: '#64748b', description: 'Feedback collected and no pending concerns.' },
  { name: 'Course / Academic Support Required', color: '#0ea5e9', description: 'Requires academic assistance.' },
  { name: 'Placement Support Required', color: '#6366f1', description: 'Requires training or placement assistance.' },
  { name: 'Fee / Payment Support Required', color: '#d97706', description: 'Requires assistance regarding fees or payments.' },
  { name: 'Learner Considering Discontinuation', color: '#e11d48', description: 'Retention intervention required.' },
  { name: 'Feedback Not Received', color: '#94a3b8', description: 'Learner declined to share feedback.' },
  { name: 'Others', color: '#475569', description: 'Any other outcome.' },
];

/** Stages used for enrolled leads (separate from sales lead stages). */
@Injectable()
export class EnrolledLeadStageService implements OnModuleInit {
  private readonly logger = new Logger(EnrolledLeadStageService.name);

  constructor(
    @InjectModel(EnrolledLeadStage.name)
    private readonly stageModel: Model<EnrolledLeadStage>,
    @InjectModel(EnrolledLead.name)
    private readonly leadModel: Model<EnrolledLead>,
  ) {}

  async onModuleInit() {
    try {
      await this.ensureDefaults();
    } catch (error: any) {
      this.logger.error(
        `Could not create default enrolled lead stages: ${error?.message}`,
      );
    }
  }

  /**
   * Makes the stage collection match STATIC_ENROLLED_STAGES exactly:
   * upserts each fixed stage (order, colour, description, active),
   * deactivates every other stage and moves its students to "Enrolled".
   */
  async ensureDefaults() {
    const keepIds: Types.ObjectId[] = [];
    let defaultStage: any = null;

    for (const [index, def] of STATIC_ENROLLED_STAGES.entries()) {
      const stage = await this.stageModel.findOneAndUpdate(
        { name: new RegExp(`^${escapeRegex(def.name)}$`, 'i') },
        {
          $set: {
            name: def.name,
            order: index,
            color: def.color,
            description: def.description,
            isActive: true,
            isDefault: !!def.isDefault,
          },
        },
        { upsert: true, new: true },
      );
      keepIds.push(stage._id as Types.ObjectId);
      if (def.isDefault) defaultStage = stage;
    }

    const removed = await this.stageModel
      .find({ _id: { $nin: keepIds }, $or: [{ isActive: true }, { isDefault: true }] })
      .select('_id name')
      .lean();
    if (!removed.length) return;

    const removedIds = removed.map((r) => r._id);
    await this.stageModel.updateMany(
      { _id: { $in: removedIds } },
      { $set: { isActive: false, isDefault: false } },
    );
    const moved = await this.leadModel.updateMany(
      { stageId: { $in: removedIds } },
      { $set: { stageId: defaultStage._id, stageName: defaultStage.name } },
    );
    this.logger.log(
      `Enrolled stages synced: deactivated ${removed.map((r) => r.name).join(', ')}; moved ${moved.modifiedCount} students to "${defaultStage.name}"`,
    );
  }

  async getDefaultStage() {
    let stage = await this.stageModel
      .findOne({ isDefault: true, isActive: true })
      .lean();
    if (!stage) {
      stage = await this.stageModel
        .findOneAndUpdate(
          { name: DEFAULT_ENROLLED_STAGE },
          {
            $set: { isActive: true, isDefault: true },
            $setOnInsert: { order: 0, color: '#f97316' },
          },
          { upsert: true, new: true },
        )
        .lean();
    }
    return stage!;
  }

  list(includeInactive = false) {
    return this.stageModel
      .find(includeInactive ? {} : { isActive: true })
      .sort({ order: 1, name: 1 })
      .lean();
  }

  async findActive(stageId: string) {
    if (!Types.ObjectId.isValid(stageId))
      throw new BadRequestException('Invalid stageId');
    const stage = await this.stageModel
      .findOne({ _id: stageId, isActive: true })
      .lean();
    if (!stage) throw new BadRequestException('Stage not found or inactive');
    return stage;
  }

  /** Stages are a fixed list (STATIC_ENROLLED_STAGES) – adding is disabled. */
  async create(_dto: EnrolledStageDto): Promise<never> {
    throw new BadRequestException('Enrolled lead stages are fixed and cannot be added');
  }

  /** Stages are a fixed list (STATIC_ENROLLED_STAGES) – editing is disabled. */
  async update(_id: string, _dto: UpdateEnrolledStageDto): Promise<never> {
    throw new BadRequestException('Enrolled lead stages are fixed and cannot be changed');
  }
}

export const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
