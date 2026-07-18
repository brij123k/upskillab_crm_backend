import { describe, expect, it, jest } from '@jest/globals';
import { Types } from 'mongoose';
import { AttendanceLogic } from './attendance.logic';
import { AttendanceStatus } from 'src/schema/attendance.schema';

describe('AttendanceLogic', () => {
  it('returns per-day metrics for a user over a requested range', async () => {
    const data = {
      findByUserAndDate: jest.fn().mockResolvedValue(null),
    };
    const kraLogic = {
      compareByUser: jest.fn().mockResolvedValue({
        status: AttendanceStatus.PRESENT,
        reason: 'KRA met',
        metrics: {
          answeredCalls: 3,
          talkTime: 120,
          dialCalls: 5,
          bookings: 1,
          demoConducts: 1,
        },
      }),
    };
    const profileData = {} as any;
    const leaveData = {
      findByUserInRange: jest.fn().mockResolvedValue([]),
    };

    const logic = new AttendanceLogic(
      data as any,
      kraLogic as any,
      profileData,
      leaveData as any,
    );

    const result = await logic.getUserDailyMetrics(
      new Types.ObjectId().toString(),
      new Date('2026-07-18T12:00:00.000Z'),
      2,
    );

    expect(result.userId).toBeDefined();
    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toMatchObject({
      date: expect.any(Date),
      metrics: expect.any(Object),
      status: AttendanceStatus.PRESENT,
    });
  });

  it('marks Sunday attendance as week_off during login', async () => {
    const data = {
      findByUserAndDate: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ _id: 'created' }),
      update: jest.fn().mockResolvedValue({ _id: 'updated' }),
    };
    const kraLogic = {
      compareByUser: jest.fn(),
    };
    const profileData = {} as any;
    const leaveData = {
      findByUserInRange: jest.fn().mockResolvedValue([]),
    };

    const logic = new AttendanceLogic(
      data as any,
      kraLogic as any,
      profileData,
      leaveData as any,
    );
    jest.spyOn(logic as any, 'reconcileAttendanceForUser').mockResolvedValue([]);

    await logic.recordLogin(new Types.ObjectId().toString(), new Date('2026-07-19T10:00:00.000Z'));

    expect(data.create).toHaveBeenCalledWith(expect.objectContaining({
      status: AttendanceStatus.WEEK_OFF,
      reason: 'Auto-marked week off for Sunday',
    }));
  });

  it('reconciles only missing recent days using KRA results', async () => {
    const data = {
      findByUserAndDate: jest.fn(),
      upsert: jest.fn(),
    };
    const kraLogic = {
      compareByUser: jest.fn(),
    };
    const profileData = {} as any;
    const leaveData = {
      findByUserInRange: jest.fn().mockResolvedValue([]),
    };
    const userModel = {} as any;

    const logic = new AttendanceLogic(
      data as any,
      kraLogic as any,
      profileData,
      leaveData as any,
    );

    data.findByUserAndDate.mockImplementation(async (_userId: string, date: Date) => {
      const iso = new Date(date).toISOString();
      if (iso === new Date('2026-07-17T00:00:00.000Z').toISOString()) {
        return null;
      }
      if (iso === new Date('2026-07-16T00:00:00.000Z').toISOString()) {
        return { _id: 'existing' };
      }
      return null;
    });
    kraLogic.compareByUser.mockResolvedValue({
      status: AttendanceStatus.PRESENT,
      reason: 'KRA met',
    });
    data.upsert.mockResolvedValue({ _id: 'created' });

    await logic.reconcileAttendanceForUser(
      new Types.ObjectId().toString(),
      new Date('2026-07-18T12:00:00.000Z'),
      2,
    );

    expect(kraLogic.compareByUser).toHaveBeenCalled();
    expect(data.upsert).toHaveBeenCalled();
  });
});
