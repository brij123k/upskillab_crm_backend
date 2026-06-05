import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { CreateAttendanceDto } from 'src/dto/attendance/create-attendance.dto';
import { UpdateAttendanceDto } from 'src/dto/attendance/update-attendance.dto';
import { AttendanceLeaveType, AttendanceStatus } from 'src/schema/attendance.schema';
import { AttendanceData } from './attendance.data';
import { KraLogic } from '../KRA/kra.logic';
import { ProfileData } from '../profile/profile.data';
import { LeaveData } from '../leaves/leave.data';
import { LeaveStatus, LeaveType } from 'src/schema/leave.schema';

@Injectable()
export class AttendanceLogic {
  constructor(
    private readonly data: AttendanceData,
    private readonly kraLogic: KraLogic,
    private readonly profileData: ProfileData,
    private readonly leaveData: LeaveData,
  ) {}

  private startOfDay(input = new Date()) {
    const d = new Date(input);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private roundWorkHours(loginTime: Date, logoutTime: Date) {
    const hours = (logoutTime.getTime() - loginTime.getTime()) / (1000 * 60 * 60);
    return Math.max(0, Math.round(hours * 100) / 100);
  }

  private calculateVintage(createdAt?: Date | string) {
    if (!createdAt) return null;

    const start = new Date(createdAt);
    if (Number.isNaN(start.getTime())) return null;

    const now = new Date();
    const diffDays = Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays < 0) return '0D';
    if (diffDays >= 365) {
      const years = Math.floor(diffDays / 365);
      const remainingDays = diffDays % 365;
      return remainingDays > 0 ? `${years}Y ${remainingDays}D` : `${years}Y`;
    }

    return `${diffDays}D`;
  }

  private endOfDay(input = new Date()) {
    const d = new Date(input);
    d.setHours(23, 59, 59, 999);
    return d;
  }

  private addDays(input: Date, days: number) {
    const d = new Date(input);
    d.setDate(d.getDate() + days);
    return d;
  }

  private getAutoWorkHours(status: AttendanceStatus) {
    switch (status) {
      case AttendanceStatus.PRESENT:
        return 8;
      case AttendanceStatus.HALF_DAY:
        return 4;
      case AttendanceStatus.LEAVE:
      case AttendanceStatus.ABSENT:
      default:
        return 0;
    }
  }

  private getAttendanceDateRange(date: Date) {
    const start = this.startOfDay(date);
    const end = this.endOfDay(date);
    return { start, end };
  }

  private async findLeaveForDate(userId: string, date: Date) {
    const { start, end } = this.getAttendanceDateRange(date);
    const leaves = await this.leaveData.findByUserInRange(userId, start, end, {
      statuses: [LeaveStatus.APPROVED, LeaveStatus.PENDING],
    });

    if (!Array.isArray(leaves) || !leaves.length) {
      return null;
    }

    return [...leaves].sort((a: any, b: any) => {
      const statusWeight = (value: any) => (String(value?.status) === LeaveStatus.APPROVED ? 0 : 1);
      const aTime = new Date(a?.updatedAt || a?.createdAt || a?.leaveFrom || a?.leaveDate || 0).getTime();
      const bTime = new Date(b?.updatedAt || b?.createdAt || b?.leaveFrom || b?.leaveDate || 0).getTime();
      return statusWeight(a) - statusWeight(b) || bTime - aTime;
    })[0];
  }

  private getLeaveAttendanceReason(leave: any) {
    const leaveType = String(leave?.leaveType || '').toUpperCase();
    const leaveStatus = String(leave?.status || '').toLowerCase();
    const rangeStart = leave?.leaveFrom || leave?.leaveDate;
    const rangeEnd = leave?.leaveTo || leave?.leaveFrom || leave?.leaveDate;
    const rangeLabel = rangeStart
      ? `${new Date(rangeStart).toLocaleDateString()}${rangeEnd ? ` to ${new Date(rangeEnd).toLocaleDateString()}` : ''}`
      : 'selected date';
    const approvalState = leaveStatus === LeaveStatus.APPROVED ? 'approved' : 'pending';
    return `Auto-marked ${leaveType || 'leave'} (${approvalState}) for ${rangeLabel}`;
  }

  private getLeaveType(value: any) {
    const normalized = String(value || '').toUpperCase();
    if (normalized === LeaveType.EL) return AttendanceLeaveType.EL;
    return AttendanceLeaveType.CL;
  }

  private async createOrUpdateAutoAttendance(userId: string, date: Date, payload: any) {
    const existing = await this.data.findByUserAndDate(userId, date);
    if (existing) {
      return existing;
    }

    return this.data.upsert(userId, date, {
      userId: new Types.ObjectId(userId),
      date,
      ...payload,
    });
  }

  private async reconcileMissingAttendanceDays(userId: string, referenceDate = new Date(), days = 4) {
    const startOffset = 1;
    const endOffset = Math.max(days, 0);

    for (let offset = startOffset; offset <= endOffset; offset += 1) {
      const targetDate = this.startOfDay(this.addDays(referenceDate, -offset));
      const existing = await this.data.findByUserAndDate(userId, targetDate);
      if (existing) continue;

      const leave = await this.findLeaveForDate(userId, targetDate);

      if (leave) {
        const leaveType = this.getLeaveType(leave.leaveType);
        await this.createOrUpdateAutoAttendance(userId, targetDate, {
          loginTime: targetDate,
          workHours: this.getAutoWorkHours(AttendanceStatus.LEAVE),
          status: AttendanceStatus.LEAVE,
          leaveType,
          reason: this.getLeaveAttendanceReason(leave),
          kraResult: {
            source: 'leave',
            leaveId: leave?._id?.toString?.() || null,
            leaveType,
            leaveStatus: leave?.status || null,
          },
        });
        continue;
      }

      const kraResult = await this.kraLogic.compareByUser(userId, targetDate);
      const status = kraResult?.status || AttendanceStatus.PRESENT;

      await this.createOrUpdateAutoAttendance(userId, targetDate, {
        loginTime: targetDate,
        workHours: this.getAutoWorkHours(status),
        status,
        reason: kraResult?.reason || 'Auto-marked from KRA comparison',
        kraResult,
      });
    }
  }

  private getSalarySheetRange(query: any) {
    const now = new Date();
    let startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    let endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const hasExplicitRange = Boolean(query?.fromDate || query?.toDate);
    if (hasExplicitRange) {
      if (query.fromDate) {
        const from = new Date(query.fromDate);
        if (!Number.isNaN(from.getTime())) {
          startDate = new Date(from);
          startDate.setHours(0, 0, 0, 0);
        }
      }

      if (query.toDate) {
        const to = new Date(query.toDate);
        if (!Number.isNaN(to.getTime())) {
          endDate = new Date(to);
          endDate.setHours(23, 59, 59, 999);
        }
      } else if (query.fromDate) {
        endDate = new Date(startDate);
        endDate.setHours(23, 59, 59, 999);
      }

      if (startDate > endDate) {
        const swap = startDate;
        startDate = endDate;
        endDate = swap;
      }
    }

    const monthLabel = startDate.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    const monthRangeLabel = `${startDate.toLocaleDateString('en-GB')} - ${endDate.toLocaleDateString('en-GB')}`;

    return {
      startDate,
      endDate,
      label: hasExplicitRange ? monthRangeLabel : monthLabel,
    };
  }

  async salarySheetReport(query: any = {}) {
    const { startDate, endDate, label } = this.getSalarySheetRange(query);

    const [profiles, attendanceRecords] = await Promise.all([
      this.profileData.findAll(),
      this.data.findAll({
        fromDate: startDate.toISOString(),
        toDate: endDate.toISOString(),
      }),
    ]);

    const attendanceByUser = new Map<string, Record<string, number>>();
    for (const record of attendanceRecords || []) {
      const userId = record?.userId?._id?.toString?.() || record?.userId?.toString?.();
      if (!userId) continue;

      const status = String(record?.status || '').toLowerCase();
      const existing = attendanceByUser.get(userId) || {
        present: 0,
        half_day: 0,
        leave: 0,
        absent: 0,
        week_off: 0,
        holiday: 0,
        late: 0,
        logged_in: 0,
        other: 0,
      };

      if (status in existing) {
        existing[status] = (existing[status] || 0) + 1;
      } else {
        existing.other = (existing.other || 0) + 1;
      }

      attendanceByUser.set(userId, existing);
    }

    const employees = (profiles || [])
      .map((profile: any) => {
        const user = profile?.userId;
        const userId = user?._id?.toString?.() || profile?.userId?.toString?.();
        if (!userId) return null;

        const counts = attendanceByUser.get(userId) || {
          present: 0,
          half_day: 0,
          leave: 0,
          absent: 0,
          week_off: 0,
          holiday: 0,
          late: 0,
          logged_in: 0,
          other: 0,
        };

        const salary = Number(profile?.salary || 0);
        const totalPresent = (counts.present || 0) + (counts.late || 0) + (counts.logged_in || 0);
        const totalHalfDay = counts.half_day || 0;
        const totalLeave = counts.leave || 0;
        const totalAbsent = counts.absent || 0;
        const wo = (counts.week_off || 0) + (counts.holiday || 0);
        const totalWorkingDays = totalPresent + totalHalfDay + totalLeave;
        const totalPayableDays = Math.max(0, totalWorkingDays + wo - totalAbsent);
        const basicSalary = salary / 30;
        const finalSalary = Math.round(basicSalary * totalPayableDays);

        return {
          userId,
          empId: user?.employeeId || '-',
          empName: user?.name || 'Unknown',
          designation: user?.role?.name || '-',
          vintage: this.calculateVintage(user?.createdAt || profile?.createdAt),
          salary,
          totalWorkingDays,
          totalPresent,
          totalHalfDay,
          totalLeave,
          wo,
          totalAbsent,
          totalPayableDays,
          basicSalary,
          finalSalary,
          email: user?.email || null,
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => {
        const aValue = String(a?.empId ?? a?.empName ?? '');
        const bValue = String(b?.empId ?? b?.empName ?? '');
        return aValue.localeCompare(bValue, undefined, { numeric: true, sensitivity: 'base' });
      });

    const totalPayroll = employees.reduce((sum: number, row: any) => sum + (row?.finalSalary || 0), 0);

    return {
      period: {
        startDate,
        endDate,
        label,
      },
      summary: {
        totalEmployees: employees.length,
        totalPayroll,
      },
      employees,
    };
  }

  async recordLogin(userId: string, loginTime = new Date()) {
    await this.reconcileMissingAttendanceDays(userId, loginTime, 4);

    const date = this.startOfDay(loginTime);
    const existing = await this.data.findByUserAndDate(userId, date);
    if (existing) {
      if (!existing.loginTime) {
        return this.data.update(existing._id.toString(), {
          loginTime,
          status: existing.status || AttendanceStatus.LOGGEDIN,
          date,
        });
      }

      return existing;
    }

    return this.data.create({
      userId: new Types.ObjectId(userId),
      loginTime,
      date,
      status: AttendanceStatus.LOGGEDIN,
      workHours: 0,
    });
  }

  async recordLogout(userId: string, logoutTime = new Date()) {
    const date = this.startOfDay(logoutTime);
    const existing = await this.data.findByUserAndDate(userId, date);
    const kraResult = await this.kraLogic.compareByUser(userId, logoutTime);

    if (!existing) {
      return this.data.create({
        userId: new Types.ObjectId(userId),
        loginTime: logoutTime,
        logoutTime,
        workHours: 0,
        status: kraResult.status || AttendanceStatus.PRESENT,
        date,
        reason: kraResult.reason || 'Auto-created on logout',
        kraResult,
      });
    }

    const loginTime = existing.loginTime || logoutTime;
    const workHours = this.roundWorkHours(new Date(loginTime), logoutTime);

    const lockedStatus =
      existing.status === AttendanceStatus.LEAVE ||
      existing.status === AttendanceStatus.WEEK_OFF ||
      existing.status === AttendanceStatus.HOLIDAY ||
      existing.status === AttendanceStatus.OTHER;

    const status = lockedStatus
      ? existing.status
      : kraResult.status || AttendanceStatus.PRESENT;

    return this.data.update(existing._id.toString(), {
      logoutTime,
      workHours,
      status,
      reason: lockedStatus ? existing.reason : kraResult.reason,
      kraResult: lockedStatus ? existing.kraResult || null : kraResult,
    });
  }

  create(dto: CreateAttendanceDto) {
    const loginTime = new Date(dto.loginTime);
    const logoutTime = dto.logoutTime ? new Date(dto.logoutTime) : undefined;
    const date = this.startOfDay(new Date(dto.date));

    const workHours =
      loginTime && logoutTime ? this.roundWorkHours(loginTime, logoutTime) : 0;

    return this.data.create({
      userId: new Types.ObjectId(dto.userId),
      loginTime,
      logoutTime,
      workHours,
      status: dto.status || AttendanceStatus.PRESENT,
      date,
      reason: dto.reason,
      leaveType: dto.leaveType,
    });
  }

  async update(id: string, dto: UpdateAttendanceDto) {
    const existing = await this.data.findById(id);
    if (!existing) {
      throw new NotFoundException('Attendance not found');
    }

    const payload: any = {};
    if (dto.loginTime !== undefined) payload.loginTime = new Date(dto.loginTime);
    if (dto.logoutTime !== undefined) payload.logoutTime = new Date(dto.logoutTime);
    if (dto.status !== undefined) payload.status = dto.status;
    if (dto.date !== undefined) payload.date = this.startOfDay(new Date(dto.date));
    if (dto.reason !== undefined) payload.reason = dto.reason;
    if (dto.leaveType !== undefined) payload.leaveType = dto.leaveType;

    if (payload.loginTime || payload.logoutTime) {
      const login = payload.loginTime || existing.loginTime;
      const logout = payload.logoutTime || existing.logoutTime;
      if (login && logout) {
        payload.workHours = this.roundWorkHours(new Date(login), new Date(logout));
      }
    }

    return this.data.update(id, payload);
  }

  delete(id: string) {
    return this.data.delete(id);
  }

  findAll(filters: any = {}) {
    return this.data.findAll(filters);
  }

  findById(id: string) {
    return this.data.findById(id);
  }

  getMyAttendance(userId: string, filters: any) {
    return this.data.findByUser(userId, filters);
  }
}
