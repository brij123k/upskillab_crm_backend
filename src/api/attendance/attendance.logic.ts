import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { CreateAttendanceDto } from 'src/dto/attendance/create-attendance.dto';
import { UpdateAttendanceDto } from 'src/dto/attendance/update-attendance.dto';
import { AttendanceStatus } from 'src/schema/attendance.schema';
import { AttendanceData } from './attendance.data';
import { KraLogic } from '../KRA/kra.logic';

@Injectable()
export class AttendanceLogic {
  constructor(
    private readonly data: AttendanceData,
    private readonly kraLogic: KraLogic,
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

  async recordLogin(userId: string, loginTime = new Date()) {
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
