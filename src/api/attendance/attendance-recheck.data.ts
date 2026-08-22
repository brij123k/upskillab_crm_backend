import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import {
  AttendanceRecheckRequest,
} from 'src/schema/attendance-recheck-request.schema';

export class AttendanceRecheckData {
  constructor(
    @InjectModel(AttendanceRecheckRequest.name)
    private readonly model: Model<AttendanceRecheckRequest>,
  ) {}

  create(data: any) {
    return this.model.create(data);
  }

  findById(id: string) {
    return this.model
      .findById(id)
      .populate(
        'attendanceId',
        'userId date status reason workHours',
      )
      .populate(
        'requestedBy',
        'name email employeeId',
      )
      .populate(
        'reviewedBy',
        'name email employeeId',
      );
  }

  findPendingByAttendance(
    attendanceId: string,
    requestedBy: string,
  ) {
    return this.model.findOne({
      attendanceId: new Types.ObjectId(attendanceId),
      requestedBy: new Types.ObjectId(requestedBy),
      status: 'pending',
    });
  }

  findByUser(userId: string) {
    return this.model
      .find({
        requestedBy: new Types.ObjectId(userId),
      })
      .populate(
        'attendanceId',
        'date status reason workHours',
      )
      .populate(
        'reviewedBy',
        'name email employeeId',
      )
      .sort({ createdAt: -1 });
  }

  findAll(filters: any = {}) {
    const query: any = {};

    if (filters.status) {
      query.status = filters.status;
    }

    if (filters.requestedBy) {
      query.requestedBy = new Types.ObjectId(
        filters.requestedBy,
      );
    }

    return this.model
      .find(query)
      .populate(
        'attendanceId',
        'userId date status reason workHours',
      )
      .populate(
        'requestedBy',
        'name email employeeId',
      )
      .populate(
        'reviewedBy',
        'name email employeeId',
      )
      .sort({ createdAt: -1 });
  }

  review(
    id: string,
    data: any,
  ) {
    return this.model
      .findByIdAndUpdate(
        id,
        {
          $set: data,
        },
        {
          new: true,
          runValidators: true,
        },
      )
      .populate(
        'attendanceId',
        'userId date status reason workHours',
      )
      .populate(
        'requestedBy',
        'name email employeeId',
      )
      .populate(
        'reviewedBy',
        'name email employeeId',
      );
  }


async findActiveByAttendanceIds(attendanceIds: string[]) {
  if (!attendanceIds.length) {
    return [];
  }

  const objectIds = attendanceIds
    .filter((id) => Types.ObjectId.isValid(id))
    .map((id) => new Types.ObjectId(id));

  return this.model
    .find({
      attendanceId: {
        $in: objectIds,
      },
      status: {
        $ne: 'completed',
      },
    })
    .populate('requestedBy', 'name email employeeId')
    .populate('reviewedBy', 'name email employeeId')
    .sort({ createdAt: -1 });
}
}