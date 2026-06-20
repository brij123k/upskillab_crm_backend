import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Level,
  LevelDocument,
} from 'src/schema/level.schema';
import { CreateLevelDto,UpdateLevelDto } from 'src/dto/create-level.dto';

@Injectable()
export class LevelService {
  constructor(
    @InjectModel(Level.name)
    private readonly levelModel: Model<LevelDocument>,
  ) {}

  async create(dto: CreateLevelDto) {
    const exists = await this.levelModel.findOne({
      name: dto.name,
    });

    if (exists) {
      throw new BadRequestException(
        'Level already exists',
      );
    }

    return this.levelModel.create(dto);
  }

async findAll() {
  return this.levelModel
    .find({
      name: { $ne: 'L100' },
    })
    .sort({ name: 1 });
}

  async findOne(id: string) {
    const level = await this.levelModel.findById(id);

    if (!level) {
      throw new NotFoundException(
        'Level not found',
      );
    }

    return level;
  }

  async findByName(name: string) {
  return this.levelModel.findOne({ name });
}

  async update(
    id: string,
    dto: UpdateLevelDto,
  ) {
    const level = await this.levelModel.findByIdAndUpdate(
      id,
      dto,
      { new: true },
    );

    if (!level) {
      throw new NotFoundException(
        'Level not found',
      );
    }

    return level;
  }

  async delete(id: string) {
    const level = await this.levelModel.findByIdAndDelete(
      id,
    );

    if (!level) {
      throw new NotFoundException(
        'Level not found',
      );
    }

    return {
      message: 'Level deleted successfully',
    };
  }
}