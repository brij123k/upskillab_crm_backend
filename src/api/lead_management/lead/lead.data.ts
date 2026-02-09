import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UserLogic } from 'src/api/user/user.logic';
import { Lead } from 'src/schema/lead_management/lead.schema';
import { User } from 'src/schema/user.schema';

export class LeadData {
  constructor(
    @InjectModel(Lead.name)
    private readonly leadModel: Model<Lead>,
    private readonly userLogic: UserLogic,
  ) { }

  async create(data: any) {
    const lastLead = await this.leadModel
      .findOne({}, { leadId: 1 })
      .sort({ leadId: -1 })
      .lean();

    const nextLeadId = lastLead?.leadId
      ? lastLead.leadId + 1
      : 1;

    return this.leadModel.create({
      ...data,
      leadId: nextLeadId,
    });
  }


  async findAllWithFilters(filters: any) {
    const {
      search,
      status,
      source,
      stageId,
      assignedTo,
      modifiedBy,
      isActive,
      dateFilter,
      fromDate,
      toDate,

      sort = 'new',
      page = 1,
      limit = 10,
    } = filters;

    const query: any = {};

    if (search) {
  const searchConditions: any[] = [
    { name: { $regex: search, $options: 'i' } },
    { phone: { $regex: search, $options: 'i' } },
    { email: { $regex: search, $options: 'i' } },
  ];

  // 🔢 employeeId lives in assignedTo (User collection)
  if (!isNaN(Number(search))) {
    const users = await this.userLogic.findbyEmpId(Number(search));
    const userIds = users.map((u) => u._id.toString());

    if (userIds.length) {
      searchConditions.push({ assignedTo: { $in: userIds } });
    }
  }

  query.$or = searchConditions;
}

    if (status) query.status = status;
    if (source) query.source = source;
    if (stageId) query.stageId = stageId;
    if (assignedTo) query.assignedTo = assignedTo;
    if (modifiedBy) query.modifiedBy = modifiedBy;
    if (isActive !== undefined)
      query.isActive = isActive === 'true';

    // 📅 DATE FILTERS
    const now = new Date();
    if (dateFilter) {
      let start: Date | null = null;

      if (dateFilter === 'today') {
        start = new Date(now.setHours(0, 0, 0, 0));
      } else if (dateFilter === 'week') {
        start = new Date();
        start.setDate(start.getDate() - 7);
      } else if (dateFilter === 'month') {
        start = new Date();
        start.setMonth(start.getMonth() - 1);
      } else if (dateFilter === 'year') {
        start = new Date();
        start.setFullYear(start.getFullYear() - 1);
      }

      if (start) {
        query.createdAt = { $gte: start };
      }
    }

    // 📅 CUSTOM DATE RANGE
    if (fromDate && toDate) {
      query.createdAt = {
        $gte: new Date(fromDate),
        $lte: new Date(toDate),
      };
    }

    // 📊 SORTING
    const sortOrder = sort === 'old' ? 1 : -1;
    // 📄 PAGINATION
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.leadModel
        .find(query)
        .populate('assignedTo', 'name email employeeId')
        .populate('stageId', 'name order')
        .sort({ createdAt: sortOrder })
        .skip(skip)
        .limit(Number(limit)),

      this.leadModel.countDocuments(query),
    ]);

    return {
      data,
      meta: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / limit),
      },
    };
  }

async findAllWithFiltersUserIds(filters: any, userIds: string[]) {
  const {
    search,
    status,
    source,
    stageId,
    assignedTo,
    modifiedBy,
    isActive,
    dateFilter,
    fromDate,
    toDate,
    connected,
    scheduler,
    sort = 'new',
    page = 1,
    limit = 10,
  } = filters;

  // 🔐 Base query → senior can see junior leads
  const query: any = {
    assignedTo: { $in: userIds },
  };

  // 🔍 SEARCH
  if (search) {
    const searchConditions: any[] = [
      { name: { $regex: search, $options: 'i' } },
      { phone: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
    ];

    // 🔢 employeeId search (partial)
    if (!isNaN(Number(search))) {
      const users = await this.userLogic.findbyEmpId(Number(search));
      const empUserIds = users.map((u) => u._id.toString());

      // ✅ intersect with allowed userIds
      const allowedIds = empUserIds.filter((id) =>
        userIds.includes(id),
      );

      if (allowedIds.length) {
        searchConditions.push({
          assignedTo: { $in: allowedIds },
        });
      }
    }

    query.$or = searchConditions;
  }

  // 🎯 Explicit assignedTo filter (OVERRIDES access rule)
  if (assignedTo) {
    query.assignedTo = assignedTo;
  }

  // 🎯 Other filters
  if (status) query.status = status;
  if (source) query.source = source;
  if (stageId) query.stageId = stageId;
  if (modifiedBy) query.modifiedBy = modifiedBy;
  if (isActive !== undefined)
    query.isActive = isActive === 'true';

  // 📅 DATE FILTERS
  const now = new Date();
  if (dateFilter) {
    let start: Date | null = null;

    if (dateFilter === 'today') {
      start = new Date(now.setHours(0, 0, 0, 0));
    } else if (dateFilter === 'week') {
      start = new Date();
      start.setDate(start.getDate() - 7);
    } else if (dateFilter === 'month') {
      start = new Date();
      start.setMonth(start.getMonth() - 1);
    } else if (dateFilter === 'year') {
      start = new Date();
      start.setFullYear(start.getFullYear() - 1);
    }

    if (start) {
      query.createdAt = { $gte: start };
    }
  }

  // 📅 Custom range
  if (fromDate && toDate) {
    query.createdAt = {
      $gte: new Date(fromDate),
      $lte: new Date(toDate),
    };
  }

  // 📊 Pagination + sorting
  const skip = (page - 1) * limit;
  const sortOrder = sort === 'old' ? 1 : -1;

  const [data, total] = await Promise.all([
    this.leadModel
      .find(query)
      .populate('assignedTo', 'name email employeeId')
      .populate('stageId', 'name order')
      .sort({ createdAt: sortOrder })
      .skip(skip)
      .limit(Number(limit)),

    this.leadModel.countDocuments(query),
  ]);

  return {
    data,
    meta: {
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / limit),
    },
  };
}




  async findAllWithFiltersUserId(filters: any, userId: string) {
    const {
      search,
      status,
      source,
      stageId,
      assignedTo,
      modifiedBy,
      isActive,
      dateFilter,
      fromDate,
      toDate,
      sort = 'new',
      page = 1,
      limit = 10,
    } = filters;

    const query: any = {};

    // 🔍 SEARCH
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }

    // 🎯 FILTERS
    if (status) query.status = status;
    if (source) query.source = source;
    if (stageId) query.stageId = stageId;
    if (assignedTo) query.assignedTo = assignedTo;
    if (modifiedBy) query.modifiedBy = modifiedBy;
    if (isActive !== undefined)
      query.isActive = isActive === 'true';

    // 📅 DATE FILTERS
    const now = new Date();
    if (dateFilter) {
      let start: Date | null = null;

      if (dateFilter === 'today') {
        start = new Date(now.setHours(0, 0, 0, 0));
      } else if (dateFilter === 'week') {
        start = new Date();
        start.setDate(start.getDate() - 7);
      } else if (dateFilter === 'month') {
        start = new Date();
        start.setMonth(start.getMonth() - 1);
      } else if (dateFilter === 'year') {
        start = new Date();
        start.setFullYear(start.getFullYear() - 1);
      }

      if (start) {
        query.createdAt = { $gte: start };
      }
    }

    // 📅 CUSTOM DATE RANGE
    if (fromDate && toDate) {
      query.createdAt = {
        $gte: new Date(fromDate),
        $lte: new Date(toDate),
      };
    }

    // 📊 SORTING
    const sortOrder = sort === 'old' ? 1 : -1;

    // 📄 PAGINATION
    const skip = (page - 1) * limit;
    const finalQuery = {
      ...query,
      assignedTo: userId,
    };
    const [data, total] = await Promise.all([
      this.leadModel
        .find(finalQuery)
        .populate('assignedTo', 'name email employeeId')
        .populate('stageId', 'name order')
        .sort({ createdAt: sortOrder })
        .skip(skip)
        .limit(Number(limit)),

      this.leadModel.countDocuments(finalQuery),
    ]);

    return {
      data,
      meta: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / limit),
      },
    };
  }
  async getLeadsByLeadIds(leadIds: number[]) {
    return this.leadModel.find(
      { leadId: { $in: leadIds } },
      { leadId: 1, name: 1, phone: 1 },
    );
  }
  getByLeadId(leadId: number) {
    return this.leadModel.findOne({ leadId: leadId });
  }

  findById(id: string) {
    return this.leadModel.findById(id);
  }
  findByIds(ids: string[]) {
    return this.leadModel.find({ _id: { $in: ids } });
  }

  update(id: string, data: any) {
    return this.leadModel.findByIdAndUpdate(id, data, {
      new: true,
    });
  }

  delete(id: string) {
    return this.leadModel.findByIdAndDelete(id);
  }

  // findIdsByDepartment(departmentId: string) {
  //   return this.leadModel
  //     .find({ departmentId, isActive: true })
  //     .select('_id assignedTo');
  // }

  assignLeadsByIds(
    leadIds: string[],
    modifiedBy: string,
    assignedTo?: string,
  ) {
    return this.leadModel.updateMany(
      { _id: { $in: leadIds } },
      {
        $set: {
          assignedTo,
          modifiedBy,
          modifiedAt: new Date(),
        },
      },
    );
  }


  bulkUpdate(
    leadIds: string[],
    updateData: any,
  ) {
    return this.leadModel.updateMany(
      { _id: { $in: leadIds } },
      {
        $set: {
          ...updateData,
          modifiedAt: new Date(),
        },
      },
    );
  }

  pullBackAndReassign(
    leadIds: string[],
    newAssignedTo: string,
    modifiedBy: string,
  ) {
    return this.leadModel.updateMany(
      { _id: { $in: leadIds } },
      {
        $set: {
          assignedTo: newAssignedTo,
          modifiedBy,
          modifiedAt: new Date(),
        },
      },
    );
  }

  findByUserId(userId: string) {
    return this.leadModel
      .find({ assignedTo: userId })
      .populate('assignedTo', 'name email employeeId')
      .populate('stageId', 'name order')
      .sort({ createdAt: -1 });
  }

  async findDuplicateLeads() {
    return this.leadModel.aggregate([
      {
        $match: {
          $or: [
            { phone: { $ne: null } },
            { email: { $ne: null } },
          ],
        },
      },

      {
        $group: {
          _id: {
            phone: "$phone",
            email: "$email",
          },
          leads: { $push: "$$ROOT" },
          count: { $sum: 1 },
        },
      },

      {
        $match: {
          count: { $gt: 1 },
        },
      },

      {
        $project: {
          _id: 0,
          phone: "$_id.phone",
          email: "$_id.email",
          count: 1,
          leads: 1,
        },
      },
    ]);
  }


  // findByDepartmentId(departmentId: string) {
  //   return this.leadModel
  //     .find({ departmentId })
  //     .populate('departmentId', 'name')
  //     .populate('assignedTo', 'name email')
  //     .populate('stageId', 'name order')
  //     .sort({ createdAt: -1 });
  // }



}
