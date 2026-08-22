import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Attendance } from 'src/schema/attendance.schema';
import { AttendanceRecheckData } from './attendance-recheck.data';

export class AttendanceData {
  constructor(
    @InjectModel(Attendance.name)
    private readonly model: Model<Attendance>,

    private readonly attendanceRecheckData: AttendanceRecheckData,
  ) {}

  create(data: any) {
    return this.model.create(data);
  }

  findById(id: string) {
    return this.model
      .findById(id)
      .populate('userId', 'name email employeeId');
  }

findByUserAndDate(userId: string, date: Date) {
  const startDate = new Date(date);
  startDate.setHours(0, 0, 0, 0);

  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 1);

  return this.model.findOne({
    userId: new Types.ObjectId(userId),
    date: {
      $gte: startDate,
      $lt: endDate,
    },
  });
}

findByUser(
  userId: string,
  filters: any = {},
) {
  const query: any = {
    userId: new Types.ObjectId(userId),
  };

  const now = new Date();

  // ---------------------------------------
  // Year
  // ---------------------------------------
  const year =
    filters.year !== undefined &&
    filters.year !== ''
      ? Number(filters.year)
      : now.getFullYear();

  if (Number.isNaN(year)) {
    throw new Error('Invalid year');
  }

  // ---------------------------------------
  // Month
  // API month = 1-12
  // JS month = 0-11
  // ---------------------------------------
  const month =
    filters.month !== undefined &&
    filters.month !== ''
      ? Number(filters.month) - 1
      : now.getMonth();

  if (
    Number.isNaN(month) ||
    month < 0 ||
    month > 11
  ) {
    throw new Error(
      'Month must be between 1 and 12',
    );
  }

  // ---------------------------------------
  // Start of requested month
  // ---------------------------------------
  const startDate = new Date(
    year,
    month,
    1,
  );

  startDate.setHours(
    0,
    0,
    0,
    0,
  );

  // ---------------------------------------
  // Start of next month
  // ---------------------------------------
  const endDate = new Date(
    year,
    month + 1,
    1,
  );

  endDate.setHours(
    0,
    0,
    0,
    0,
  );

  query.date = {
    $gte: startDate,
    $lt: endDate,
  };

  return this.model
    .find(query)
    .populate(
      'userId',
      'name email employeeId',
    )
    .sort({
      date: -1,
      loginTime: -1,
    });
}

async findAll(filters: any = {}) {
  const query: any = {};

  if (filters.userId) {
    query.userId = new Types.ObjectId(filters.userId);
  }

  if (filters.status) {
    query.status = filters.status;
  }

  // ---------------------------------------
  // Month / Year attendance filter
  // ---------------------------------------
  const hasMonth = filters.month !== undefined;
  const hasYear = filters.year !== undefined;

  if (hasMonth || hasYear) {
    const now = new Date();

    const year = hasYear
      ? Number(filters.year)
      : now.getFullYear();

    const month = hasMonth
      ? Number(filters.month) - 1
      : now.getMonth();

    if (Number.isNaN(year)) {
      throw new Error('Invalid year');
    }

    if (
      Number.isNaN(month) ||
      month < 0 ||
      month > 11
    ) {
      throw new Error(
        'Month must be between 1 and 12',
      );
    }

    const startDate = new Date(
      year,
      month,
      1,
    );

    startDate.setHours(
      0,
      0,
      0,
      0,
    );

    const endDate = new Date(
      year,
      month + 1,
      1,
    );

    endDate.setHours(
      0,
      0,
      0,
      0,
    );

    query.date = {
      $gte: startDate,
      $lt: endDate,
    };
  }

  // ---------------------------------------
  // Existing fromDate / toDate support
  // ---------------------------------------
  else if (
    filters.fromDate ||
    filters.toDate
  ) {
    query.date = {};

    if (filters.fromDate) {
      query.date.$gte = new Date(
        filters.fromDate,
      );
    }

    if (filters.toDate) {
      query.date.$lte = new Date(
        filters.toDate,
      );
    }
  }

  // ---------------------------------------
  // Get attendance
  // ---------------------------------------
  const attendances = await this.model
    .find(query)
    .populate(
      'userId',
      'name email employeeId',
    )
    .sort({
      date: -1,
      loginTime: -1,
    });

  // ---------------------------------------
  // Get attendance IDs
  // ---------------------------------------
  const attendanceIds = attendances
    .map((attendance: any) =>
      attendance?._id?.toString(),
    )
    .filter(Boolean);

  // ---------------------------------------
  // Get pending/rejected requests
  // completed requests are skipped
  // ---------------------------------------
  const requests =
    await this.attendanceRecheckData
      .findActiveByAttendanceIds(
        attendanceIds,
      );

  // ---------------------------------------
  // Map request by attendance ID
  // ---------------------------------------
  const requestMap = new Map<
    string,
    any
  >();

  for (const request of requests) {
    const attendanceId =
      request?.attendanceId?._id?.toString?.() ||
      request?.attendanceId?.toString?.();

    if (!attendanceId) {
      continue;
    }

    // Only keep the latest request
    // if somehow multiple active requests exist
    if (!requestMap.has(attendanceId)) {
      requestMap.set(
        attendanceId,
        request,
      );
    }
  }

  // ---------------------------------------
  // Attach request to attendance
  // ---------------------------------------
  return attendances.map(
    (attendance: any) => {
      const attendanceId =
        attendance?._id?.toString();

      const request =
        requestMap.get(
          attendanceId,
        ) || null;

      return {
        ...attendance.toObject(),

        attendanceRequest:
          request
            ? {
                _id:
                  request._id,

                status:
                  request.status,

                requestedStatus:
                  request.requestedStatus,

                requestReason:
                  request.requestReason,

                requestedBy:
                  request.requestedBy,

                reviewedBy:
                  request.reviewedBy,

                reviewedAt:
                  request.reviewedAt,

                reviewRemark:
                  request.reviewRemark,

                rejectedReason:
                  request.rejectedReason,

                createdAt:
                  request.createdAt,
              }
            : null,
      };
    },
  );
}

  update(id: string, data: any) {
    return this.model
      .findByIdAndUpdate(id, data, { new: true })
      .populate('userId', 'name email employeeId');
  }

  delete(id: string) {
    return this.model.findByIdAndDelete(id);
  }

  upsert(userId: string, date: Date, data: any) {
    return this.model.findOneAndUpdate(
      { userId: new Types.ObjectId(userId), date },
      { $set: data },
      { new: true, upsert: true },
    ).populate('userId', 'name email employeeId');
  }

changeStatus(
  id: string,
  status: string,
  remark: string,
  changedBy: string,
) {
  return this.model
    .findByIdAndUpdate(
      id,
      {
        $set: {
          status,
          statusChangeRemark: remark,
          statusChangedBy: new Types.ObjectId(changedBy),
          statusChangedAt: new Date(),
        },
      },
      {
        new: true,
        runValidators: true,
      },
    )
    .populate('userId', 'name email employeeId')
    .populate('statusChangedBy', 'name email employeeId');
}
}
