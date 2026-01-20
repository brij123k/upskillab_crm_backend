import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Lead } from 'src/schema/lead_management/lead.schema';

export class LeadData {
  constructor(
    @InjectModel(Lead.name)
    private readonly leadModel: Model<Lead>,
  ) { }

  create(data: any) {
    return this.leadModel.create(data);
  }

  async findAllWithFilters(filters: any) {
    const {
      search,
      status,
      source,
      departmentId,
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
    if (departmentId) query.departmentId = departmentId;
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
        .populate('departmentId', 'name')
        .populate('assignedTo', 'name email')
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

  findIdsByDepartment(departmentId: string) {
  return this.leadModel
    .find({ departmentId, isActive: true })
    .select('_id assignedTo');
}

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
      .populate('departmentId', 'name')
      .populate('assignedTo', 'name email')
      .populate('stageId', 'name order')
      .sort({ createdAt: -1 });
  }

  findByDepartmentId(departmentId: string) {
    return this.leadModel
      .find({ departmentId })
      .populate('departmentId', 'name')
      .populate('assignedTo', 'name email')
      .populate('stageId', 'name order')
      .sort({ createdAt: -1 });
  }
  


}
