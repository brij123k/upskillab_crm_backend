
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import {
  LeadStageHistory,
  LeadStageHistoryDocument,
} from 'src/schema/lead_management/LeadStageHistory.schema';

@Injectable()
export class LeadStageHistoryService {
  constructor(
    @InjectModel(LeadStageHistory.name)
    private readonly leadStageHistoryModel: Model<LeadStageHistoryDocument>,
  ) {}

  async createHistory(data: {
  leadId: string;
  stageId: string;
  stageName: string;
  userId: string;
}) {
  return await this.leadStageHistoryModel.create({
    leadId: new Types.ObjectId(data.leadId),
    stageId: new Types.ObjectId(data.stageId),
    stageName: data.stageName,
    userId: new Types.ObjectId(data.userId),
    changedAt: new Date(),
  });
}
async getLeadHistory(leadId: string) {
  return await this.leadStageHistoryModel
    .find({
      leadId: new Types.ObjectId(leadId),
    })
    .populate('userId', 'name employeeId')
    .populate('stageId', 'name')
    .sort({
      changedAt: -1,
    });
}
async getLeadStageCountByDate(
  leadId: string,
  stageId: string,
  date: Date,
) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);

  const end = new Date(date);
  end.setHours(23, 59, 59, 999);

  const count =
    await this.leadStageHistoryModel.countDocuments({
      leadId: new Types.ObjectId(leadId),
      stageId: new Types.ObjectId(stageId),
      changedAt: {
        $gte: start,
        $lte: end,
      },
    });

  return {
    leadId,
    stageId,
    date: start,
    count,
  };
}
async getLeadAllStageCountsByDate(
  leadId: string,
  date: Date,
) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);

  const end = new Date(date);
  end.setHours(23, 59, 59, 999);

  const stages =
    await this.leadStageHistoryModel.aggregate([
      {
        $match: {
          leadId: new Types.ObjectId(leadId),
          changedAt: {
            $gte: start,
            $lte: end,
          },
        },
      },
      {
        $group: {
          _id: {
            stageId: '$stageId',
            stageName: '$stageName',
          },
          count: {
            $sum: 1,
          },
        },
      },
      {
        $sort: {
          '_id.stageName': 1,
        },
      },
    ]);

  const total = stages.reduce(
    (sum, item) => sum + item.count,
    0,
  );

  return {
    leadId,
    date: start,
    total,
    stages: stages.map((item) => ({
      stageId: item._id.stageId,
      stageName: item._id.stageName,
      count: item.count,
    })),
  };
}

async getUserStageCountByDate(
  userId: string,
  stageId: string,
  date: Date,
) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);

  const end = new Date(date);
  end.setHours(23, 59, 59, 999);

  const count =
    await this.leadStageHistoryModel.countDocuments({
      userId: new Types.ObjectId(userId),
      stageId: new Types.ObjectId(stageId),
      changedAt: {
        $gte: start,
        $lte: end,
      },
    });

  return {
    userId,
    stageId,
    date: start,
    count,
  };
}
async getUserAllStageCountsByDate(
  userId: string,
  date: Date,
) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);

  const end = new Date(date);
  end.setHours(23, 59, 59, 999);

  const result =
    await this.leadStageHistoryModel.aggregate([
      {
        $match: {
          userId: new Types.ObjectId(userId),
          changedAt: {
            $gte: start,
            $lte: end,
          },
        },
      },
      {
        $group: {
          _id: {
            stageId: '$stageId',
            stageName: '$stageName',
          },
          count: {
            $sum: 1,
          },
        },
      },
      {
        $sort: {
          '_id.stageName': 1,
        },
      },
    ]);

  const total = result.reduce(
    (sum, item) => sum + item.count,
    0,
  );

  return {
    userId,
    date: start,
    total,
    stages: result.map((item) => ({
      stageId: item._id.stageId,
      stageName: item._id.stageName,
      count: item.count,
    })),
  };
}
}

