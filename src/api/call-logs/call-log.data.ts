import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CallLog } from 'src/schema/call-log.schema';
import { PipelineStage } from 'mongoose';
import { Lead } from 'src/schema/lead_management/lead.schema';
import { LeadInteractionLog } from 'src/schema/lead-interaction-log.schema';
import { Types } from 'mongoose';
export class CallLogData {
  constructor(
    @InjectModel(CallLog.name)
    private readonly callLogModel: Model<CallLog>,

    @InjectModel(Lead.name)
    private readonly leadModel: Model<Lead>,

    @InjectModel(LeadInteractionLog.name)
    private readonly interactionModel: Model<LeadInteractionLog>,
  ) { }

  create(data: any) {
    return this.callLogModel.create(data);
  }

  findByLeadId(leadId: number) {
    return this.callLogModel
      .find({ leadId })
      .populate('userId', 'name email')
      .populate('stageId', 'name')
      .sort({ createdAt: -1 });
  }

  async findWithPagination(filters: any, userId?: string) {
    const {
      leadId,
      outcome,
      page = 1,
      limit = 10,
    } = filters;

    const match: any = {};

    if (leadId) match.leadId = Number(leadId);
    if (outcome) match.outcome = outcome;
    if (userId) match.userId = userId;

    const skip = (page - 1) * limit;

    const pipeline: PipelineStage[] = [
      { $match: match },

      { $sort: { createdAt: -1 } },

      {
        $group: {
          _id: "$leadId",
          latestCall: { $first: "$$ROOT" },
        },
      },

      { $replaceRoot: { newRoot: "$latestCall" } },

      { $skip: skip },
      { $limit: Number(limit) },

      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          as: "userId",
        },
      },
      // { $unwind: { path: "$userId", preserveNullAndEmptyArrays: true } },

      {
        $lookup: {
          from: "stages",
          localField: "stageId",
          foreignField: "_id",
          as: "stageId",
        },
      },
      // { $unwind: { path: "$stageId", preserveNullAndEmptyArrays: true } },
    ];


    const countPipeline: PipelineStage[] = [
      { $match: match },
      { $group: { _id: "$leadId" } },
      { $count: "total" },
    ];


    const [data, countResult] = await Promise.all([
      this.callLogModel.aggregate(pipeline),
      this.callLogModel.aggregate(countPipeline),
    ]);

    const total = countResult[0]?.total || 0;

    return {
      data,
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / limit),
    };
  }

  async findCallLogWithPagination(filters: any, userId?: string) {
    const {
      search,
      leadId,
      stageId,
      outcome,
      durationMin,
      durationMax,
      answered,
      byUserId,
      dateFilter = 'today',
      fromDate,
      toDate,
      sort = 'new',
      page = 1,
      limit = 10,
      type = 'uniq',
    } = filters;

    const match: any = {};

    // ==========================
    // FILTERS
    // ==========================
    if (leadId) match.leadId = Number(leadId);
    if (stageId) match.stageId = stageId;
    if (outcome) match.outcome = outcome;

    if (durationMin || durationMax) {
      match.duration = {};
      if (durationMin) match.duration.$gte = Number(durationMin);
      if (durationMax) match.duration.$lte = Number(durationMax);
    }

    if (answered !== undefined) {
      if (answered === true || answered === 'true') {
        match.duration = { ...(match.duration || {}), $gt: 0 };
      } else {
        match.duration = { ...(match.duration || {}), $eq: 0 };
      }
    }

    if (byUserId) match.userId = byUserId;
    else if (userId) match.userId = userId;

    if (search) {
      const conditions: any[] = [
        { outcome: { $regex: search, $options: 'i' } },
      ];

      if (!isNaN(Number(search))) {
        conditions.push(
          { leadId: Number(search) },
          { duration: Number(search) },
        );
      }

      match.$or = conditions;
    }

    // ==========================
    // DATE FILTER
    // ==========================
    let startDate = new Date();
    let endDate = new Date();

    if (dateFilter === 'today') {
      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(23, 59, 59, 999);
    }

    if (dateFilter === 'week') {
      startDate = new Date();
      startDate.setDate(startDate.getDate() - 7);
      endDate = new Date();
    }

    if (dateFilter === 'month') {
      startDate = new Date();
      startDate.setMonth(startDate.getMonth() - 1);
      endDate = new Date();
    }

    if (fromDate && toDate) {
      startDate = new Date(fromDate);
      endDate = new Date(toDate);
    }

    match.createdAt = {
      $gte: startDate,
      $lte: endDate,
    };

    const sortOrder: 1 | -1 = sort === 'old' ? 1 : -1;
    const skip = (page - 1) * Number(limit);

    // ==========================
    // UNIQUE MODE
    // ==========================
    const uniquePipeline: PipelineStage[] =
      type === 'uniq'
        ? [
          { $sort: { createdAt: -1 } },
          {
            $group: {
              _id: '$leadId',
              latestCall: { $first: '$$ROOT' },
            },
          },
          {
            $replaceRoot: {
              newRoot: '$latestCall',
            },
          },
        ]
        : [];

    // ==========================
    // SINGLE AGGREGATION
    // ==========================
    const result = await this.callLogModel.aggregate([
      { $match: match },

      ...uniquePipeline,

      {
        $lookup: {
          from: 'users',
          let: {
            uid: { $toObjectId: '$userId' },
          },
          pipeline: [
            {
              $match: {
                $expr: {
                  $eq: ['$_id', '$$uid'],
                },
              },
            },
            {
              $project: {
                _id: 1,
                name: 1,
                employeeId: 1,
              },
            },
          ],
          as: 'userId',
        },
      },

      {
        $unwind: {
          path: '$userId',
          preserveNullAndEmptyArrays: true,
        },
      },

      {
        $lookup: {
          from: 'leadstages',
          let: {
            sid: { $toObjectId: '$stageId' },
          },
          pipeline: [
            {
              $match: {
                $expr: {
                  $eq: ['$_id', '$$sid'],
                },
              },
            },
            {
              $project: {
                _id: 1,
                name: 1,
              },
            },
          ],
          as: 'stageId',
        },
      },

      {
        $unwind: {
          path: '$stageId',
          preserveNullAndEmptyArrays: true,
        },
      },

      {
        $lookup: {
          from: 'leads',
          localField: 'leadId',
          foreignField: 'leadId',
          as: 'lead',
        },
      },

      {
        $unwind: {
          path: '$lead',
          preserveNullAndEmptyArrays: true,
        },
      },

      {
        $addFields: {
          leadName: '$lead.name',
          leadNumber: '$lead.phone',
          answered: {
            $gt: ['$duration', 0],
          },
        },
      },

      {
        $facet: {
          data: [
            {
              $sort: {
                createdAt: sortOrder as 1 | -1,
              },
            },
            { $skip: skip },
            { $limit: Number(limit) },
          ],

          total: [
            {
              $count: 'count',
            },
          ],

          stats: [
            {
              $group: {
                _id: null,
                totalDials: {
                  $sum: 1,
                },
                totalAnswered: {
                  $sum: {
                    $cond: [
                      { $gt: ['$duration', 0] },
                      1,
                      0,
                    ],
                  },
                },
                totalTalkTime: {
                  $sum: '$duration',
                },
              },
            },
          ],
        },
      },
    ]);

    const response = result[0];

    const total = response.total?.[0]?.count || 0;

    const stats = {
      totalDials: response.stats?.[0]?.totalDials || 0,
      totalAnswered: response.stats?.[0]?.totalAnswered || 0,
      totalTalkTime: response.stats?.[0]?.totalTalkTime || 0,
    };

    return {
      data: response.data || [],
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / Number(limit)),
      stats,
    };
  }


  async findAllWithUserIds(
    filters: any,
    accessibleUserIds: string[],
  ) {
    const {
      search,
      leadId,
      stageId,
      outcome,
      durationMin,
      durationMax,
      answered,
      byUserId,
      type = 'all',
      logType,
      dateFilter = 'today',
      fromDate,
      toDate,
      sort = 'new',
      page = 1,
      limit = 10,
    } = filters;

    const callMatch: any = {};
    const interactionMatch: any = {};

    // ==================================
    // COMMON FILTERS
    // ==================================

    if (leadId) {
      callMatch.leadId = Number(leadId);
      interactionMatch.leadId = Number(leadId);
    }

    if (stageId) {
      callMatch.stageId = stageId;
      interactionMatch.stageId = stageId;
    }

    if (outcome) {
      callMatch.outcome = { $regex: outcome, $options: 'i' };
      interactionMatch.outcome = { $regex: outcome, $options: 'i' };
    }

    if (byUserId) {
  callMatch.userId = byUserId;
  interactionMatch.userId = byUserId;
} else {
  callMatch.userId = {
    $in: accessibleUserIds,
  };

  interactionMatch.userId = {
    $in: accessibleUserIds,
  };
}

    // ==================================
    // SEARCH
    // ==================================

    if (search) {
      callMatch.$or = [
        { outcome: { $regex: search, $options: 'i' } },
      ];

      interactionMatch.$or = [
        { outcome: { $regex: search, $options: 'i' } },
        { source: { $regex: search, $options: 'i' } },
      ];

      if (!isNaN(Number(search))) {
        callMatch.$or.push(
          { leadId: Number(search) },
          { duration: Number(search) },
        );

        interactionMatch.$or.push({
          leadId: Number(search),
        });
      }
    }

    // ==================================
    // CALL ONLY FILTERS
    // ==================================

    if (durationMin || durationMax) {
      callMatch.duration = {};

      if (durationMin) {
        callMatch.duration.$gte = Number(durationMin);
      }

      if (durationMax) {
        callMatch.duration.$lte = Number(durationMax);
      }
    }

    if (answered !== undefined) {
      if (answered === true || answered === 'true') {
        callMatch.duration = {
          ...(callMatch.duration || {}),
          $gt: 0,
        };
      } else {
        callMatch.duration = {
          ...(callMatch.duration || {}),
          $eq: 0,
        };
      }
    }

    // ==================================
    // DATE FILTER
    // ==================================

    let startDate = new Date();
    let endDate = new Date();

    if (dateFilter === 'today') {
      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(23, 59, 59, 999);
    }

    if (dateFilter === 'week') {
      startDate = new Date();
      startDate.setDate(startDate.getDate() - 7);
      endDate = new Date();
    }

    if (dateFilter === 'month') {
      startDate = new Date();
      startDate.setMonth(startDate.getMonth() - 1);
      endDate = new Date();
    }

    if (dateFilter === 'year') {
      startDate = new Date();
      startDate.setFullYear(startDate.getFullYear() - 1);
      endDate = new Date();
    }

    if (fromDate && toDate) {
      startDate = new Date(fromDate);
      endDate = new Date(toDate);
    }

    callMatch.createdAt = {
      $gte: startDate,
      $lte: endDate,
    };

    interactionMatch.createdAt = {
      $gte: startDate,
      $lte: endDate,
    };

    // ==================================
    // FETCH DATA
    // ==================================

    let callLogs: any[] = [];
    let interactionLogs: any[] = [];

    const normalizedLogType =
      logType?.toString()?.toLowerCase();

    if (normalizedLogType === 'call') {
      callLogs = await this.callLogModel
        .find(callMatch)
        .populate('stageId', 'name')
        .lean();
    } else if (
      normalizedLogType === 'manual' ||
      normalizedLogType === 'interaction'
    ) {
      interactionLogs = await this.interactionModel
        .find(interactionMatch)
        .populate('stageId', 'name')
        .lean();
    } else {
      [callLogs, interactionLogs] =
        await Promise.all([
          this.callLogModel
            .find(callMatch)
            .populate('stageId', 'name')
            .lean(),

          this.interactionModel
            .find(interactionMatch)
            .populate('stageId', 'name')
            .lean(),
        ]);
    }
    // ==================================
    // MERGE
    // ==================================

    const merged = [
      ...callLogs.map((item: any) => ({
        ...item,
        logType: 'call',
        source: 'call',
      })),

      ...interactionLogs.map((item: any) => ({
        ...item,
        logType: 'manual',
        duration: null,
      })),
    ];

    // ==================================
    // USER LOOKUP
    // ==================================

    const userIds = [
      ...new Set(
        merged
          .map((x: any) => x.userId?.toString())
          .filter(Boolean),
      ),
    ];

    const users = await this.callLogModel.db
      .collection('users')
      .find({
        _id: {
          $in: userIds.map(
            (id) => new Types.ObjectId(id),
          ),
        },
      })
      .project({
        name: 1,
        employeeId: 1,
      })
      .toArray();

    const userMap = new Map(
      users.map((u: any) => [
        u._id.toString(),
        u,
      ]),
    );

    // ==================================
    // LEAD LOOKUP
    // ==================================

    const leadIds = [
      ...new Set(
        merged.map((x: any) => x.leadId),
      ),
    ];

    const leads = await this.leadModel
      .find(
        {
          leadId: {
            $in: leadIds,
          },
        },
        {
          leadId: 1,
          name: 1,
          phone: 1,
        },
      )
      .lean();

    const leadMap = new Map(
      leads.map((l: any) => [
        l.leadId,
        l,
      ]),
    );

    const callCountMatch: any = {
      leadId: { $in: leadIds },
      createdAt: {
        $gte: new Date(
          Date.now() - 30 * 24 * 60 * 60 * 1000,
        ),
      },
    };

    if (byUserId) {
      callCountMatch.userId = byUserId;
    } else {
      callCountMatch.userId = {
        $in: accessibleUserIds,
      };
    }

    const callCounts = await this.callLogModel.aggregate([
      { $match: callCountMatch },
      {
        $group: {
          _id: '$leadId',
          count: { $sum: 1 },
        },
      },
    ]);

    const callCountMap = new Map(
      callCounts.map((x: any) => [
        x._id,
        x.count,
      ]),
    );
    // ==================================
    // ENRICH
    // ==================================

    const finalData = merged.map((item: any) => {
      const user = userMap.get(
        item.userId?.toString(),
      );

      const lead = leadMap.get(
        item.leadId,
      );

      return {
        ...item,
        callCount30Days:
          callCountMap.get(item.leadId) || 0,

        answered:
          item.logType === 'manual'
            ? true
            : (item.duration || 0) > 0,
        userId: user
          ? {
            _id: user._id,
            name: user.name,
            employeeId: user.employeeId,
          }
          : null,

        leadName: lead?.name || null,
        leadNumber: lead?.phone || null,
      };
    });

    let processedData = [...finalData];

    if (type === 'uniq') {
      const uniqueMap = new Map();

      for (const item of processedData) {
        const existing = uniqueMap.get(item.leadId);

        if (
          !existing ||
          new Date(item.createdAt).getTime() >
          new Date(existing.createdAt).getTime()
        ) {
          uniqueMap.set(item.leadId, item);
        }
      }

      processedData = Array.from(
        uniqueMap.values(),
      );
    }

    // ==================================
    // SORT
    // ==================================

    processedData.sort((a: any, b: any) => {
      const first = new Date(
        a.createdAt,
      ).getTime();

      const second = new Date(
        b.createdAt,
      ).getTime();

      return sort === 'old'
        ? first - second
        : second - first;
    });

    // ==================================
    // PAGINATION
    // ==================================

    const total = processedData.length;

    const paginated = processedData.slice(
      (Number(page) - 1) * Number(limit),
      Number(page) * Number(limit),
    );

    // ==================================
    // STATS
    // ==================================

    const stats = {
      logType: normalizedLogType || 'all',

      totalDials: callLogs.length,

      totalAnswered: callLogs.filter(
        (x: any) => (x.duration || 0) > 0,
      ).length,

      totalTalkTime: callLogs.reduce(
        (a: number, b: any) =>
          a + (b.duration || 0),
        0,
      ),

      totalInteractions:
        interactionLogs.length,

      totalRecords:
        callLogs.length +
        interactionLogs.length,
    };

    return {
      data: paginated,
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(
        total / Number(limit),
      ),
      stats,
    };
  }






  findById(id: string) {
    return this.callLogModel.findById(id);
  }

  update(id: string, data: any) {
    return this.callLogModel.findByIdAndUpdate(id, data, { new: true });
  }

  delete(id: string) {
    return this.callLogModel.findByIdAndDelete(id);
  }
}
