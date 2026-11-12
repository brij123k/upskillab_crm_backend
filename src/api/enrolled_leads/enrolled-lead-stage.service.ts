import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
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

const DEFAULT_STAGES = [
  { name: DEFAULT_ENROLLED_STAGE, color: '#f97316', isDefault: true },
  { name: 'Called', color: '#3b82f6' },
  { name: 'WhatsApp Sent', color: '#22c55e' },
  { name: 'Follow Up', color: '#eab308' },
  { name: 'Not Reachable', color: '#94a3b8' },
  { name: 'Interested', color: '#8b5cf6' },
  { name: 'Not Interested', color: '#ef4444' },
  { name: 'Completed', color: '#0d9488' },
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

  /** Creates the default stages once (when there are none). */
  async ensureDefaults() {
    if ((await this.stageModel.estimatedDocumentCount()) > 0) return;
    await this.stageModel.insertMany(
      DEFAULT_STAGES.map((stage, index) => ({
        isDefault: false,
        ...stage,
        order: index + 1,
      })),
      { ordered: false },
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

  async create(dto: EnrolledStageDto) {
    const name = dto.name.trim();
    if (
      await this.stageModel.exists({
        name: new RegExp(`^${escapeRegex(name)}$`, 'i'),
      })
    ) {
      throw new ConflictException('A stage with this name already exists');
    }
    const last = await this.stageModel.findOne().sort({ order: -1 }).lean();
    return this.stageModel.create({
      name,
      color: dto.color || '#64748b',
      order: dto.order ?? (last?.order ?? 0) + 1,
    });
  }

  async update(id: string, dto: UpdateEnrolledStageDto) {
    if (!Types.ObjectId.isValid(id))
      throw new BadRequestException('Invalid stage id');
    const stage = await this.stageModel.findById(id);
    if (!stage) throw new NotFoundException('Stage not found');

    if (dto.isActive === false && (stage.isDefault || dto.isDefault)) {
      throw new BadRequestException('The default stage cannot be deactivated');
    }

    const oldName = stage.name;
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      const clash = await this.stageModel.exists({
        _id: { $ne: stage._id },
        name: new RegExp(`^${escapeRegex(name)}$`, 'i'),
      });
      if (clash)
        throw new ConflictException('A stage with this name already exists');
      stage.name = name;
    }
    if (dto.order !== undefined) stage.order = dto.order;
    if (dto.color !== undefined) stage.color = dto.color;
    if (dto.isActive !== undefined) stage.isActive = dto.isActive;
    if (dto.isDefault === true) {
      await this.stageModel.updateMany(
        { _id: { $ne: stage._id } },
        { $set: { isDefault: false } },
      );
      stage.isDefault = true;
      stage.isActive = true;
    }
    await stage.save();

    // Keep the denormalised stage name on leads in step.
    if (stage.name !== oldName) {
      await this.leadModel.updateMany(
        { stageId: stage._id },
        { $set: { stageName: stage.name } },
      );
    }
    return stage.toObject();
  }
}

export const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
