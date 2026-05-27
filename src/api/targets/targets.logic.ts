import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { TargetsData } from './targets.data';
import { TargetMetricKey } from 'src/schema/target.schema';
import { CallLog } from 'src/schema/call-log.schema';
import { MeetingLog } from 'src/schema/meeting-log.schema';
import { Lead } from 'src/schema/lead_management/lead.schema';
import { Order } from 'src/schema/order_Management/order.schema';
import { Task } from 'src/schema/task.schema';
import { User } from 'src/schema/user.schema';
import { ProfileData } from '../profile/profile.data';

type MetricMap = Record<TargetMetricKey, number>;
type AccessibleTargetUser = {
  userId: string;
  employeeId: string | number | null;
  name: string;
  email: string | null;
  roleName: string;
  level: number;
  createdAt: Date | string | null;
};

@Injectable()
export class TargetsLogic {
  constructor(
    private readonly data: TargetsData,
    private readonly profileData: ProfileData,
    @InjectModel(CallLog.name) private readonly callLogModel: Model<CallLog>,
    @InjectModel(MeetingLog.name) private readonly meetingLogModel: Model<MeetingLog>,
    @InjectModel(Lead.name) private readonly leadModel: Model<Lead>,
    @InjectModel(Order.name) private readonly orderModel: Model<Order>,
    @InjectModel(Task.name) private readonly taskModel: Model<Task>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
  ) {}

  private readonly metricKeys: TargetMetricKey[] = ['calls', 'meets', 'pcatDone', 'registrationDone', 'revenue', 'tasks'];

  private startOfMonth(monthKey?: string) {
    const date = monthKey ? new Date(`${monthKey}-01T00:00:00.000Z`) : new Date();
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('Invalid month');
    }
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0));
  }

  private endOfMonth(monthKey?: string) {
    const start = this.startOfMonth(monthKey);
    return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0, 23, 59, 59, 999));
  }

  private normalizeMonthKey(month?: string) {
    const base = month ? new Date(`${month}-01T00:00:00.000Z`) : new Date();
    if (Number.isNaN(base.getTime())) {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }
    return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  private resolveLevel(level?: any) {
    if (level === undefined || level === null || String(level).trim() === '') {
      return 1;
    }

    const parsed = Number(level);
    if (Number.isNaN(parsed)) {
      throw new BadRequestException('Invalid level');
    }

    return parsed;
  }

  private resolveMonthKeys(months?: any, fallbackMonth?: string) {
    const rawValues: string[] = Array.isArray(months)
      ? months.flatMap((item) => String(item).split(','))
      : typeof months === 'string'
        ? months.split(',')
        : fallbackMonth
          ? [fallbackMonth]
          : [];

    const normalized = rawValues
      .map((item) => this.normalizeMonthKey(item.trim()))
      .filter(Boolean);

    const unique = Array.from(new Set(normalized));
    unique.sort((a, b) => (a < b ? 1 : -1));

    return unique.length ? unique : [this.normalizeMonthKey(fallbackMonth)];
  }

  private formatMonthLabel(monthKey: string) {
    return new Date(`${monthKey}-01T00:00:00.000Z`).toLocaleString('en-US', {
      month: 'short',
      year: '2-digit',
    });
  }

  private getMonthMeta(monthKey: string) {
    const startDate = this.startOfMonth(monthKey);
    const endDate = this.endOfMonth(monthKey);
    const now = new Date();
    const isCurrentMonth =
      startDate.getUTCFullYear() === now.getUTCFullYear() &&
      startDate.getUTCMonth() === now.getUTCMonth();
    const currentDay = isCurrentMonth ? now.getDate() : new Date(endDate).getUTCDate();
    const totalDays = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + 1, 0)).getUTCDate();
    const daysLeft = Math.max(0, totalDays - currentDay);

    return { startDate, endDate, currentDay, totalDays, daysLeft, isCurrentMonth };
  }

  private blankMetrics(): MetricMap {
    return {
      calls: 0,
      meets: 0,
      pcatDone: 0,
      registrationDone: 0,
      revenue: 0,
      tasks: 0,
    };
  }

  private normalizeTargets(targets: Partial<MetricMap> | undefined) {
    const base = this.blankMetrics();
    for (const key of this.metricKeys) {
      base[key] = Number(targets?.[key] || 0);
    }
    return base;
  }

  private async getAccessibleUsers() {
    const profiles = await this.profileData.findAll();
    return (profiles || [])
      .map((profile: any) => {
        const user = profile?.userId;
        if (!user?._id) return null;
        const level = Number(user?.role?.level ?? 1);
        return {
          userId: user._id.toString(),
          employeeId: user.employeeId || null,
          name: user.name || 'Unknown',
          email: user.email || null,
          roleName: user?.role?.name || '-',
          level: Number.isNaN(level) ? 1 : level,
          createdAt: user.createdAt || profile.createdAt || null,
        } as AccessibleTargetUser;
      })
      .filter((user): user is AccessibleTargetUser => Boolean(user));
  }

  private async buildMetricMaps(userIds: string[], startDate: Date, endDate: Date) {
    const userIdSet = new Set(userIds.map((id) => String(id)));
    const allow = (userId: string | null | undefined) => userId ? userIdSet.has(String(userId)) : false;

    const [callRows, meetingRows, pcatRows, registrationRows, revenueRows, taskRows] = await Promise.all([
      this.callLogModel.aggregate([
        { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
        {
          $group: {
            _id: {
              $convert: {
                input: '$userId',
                to: 'string',
                onError: null,
                onNull: null,
              },
            },
            count: { $sum: 1 },
          },
        },
      ]),
      this.meetingLogModel.aggregate([
        { $match: { startedAt: { $gte: startDate, $lte: endDate } } },
        {
          $group: {
            _id: {
              $convert: {
                input: '$userId',
                to: 'string',
                onError: null,
                onNull: null,
              },
            },
            count: { $sum: 1 },
          },
        },
      ]),
      this.leadModel.aggregate([
        { $match: { pcatDoneDate: { $gte: startDate, $lte: endDate } } },
        {
          $group: {
            _id: {
              $convert: {
                input: '$assignedTo',
                to: 'string',
                onError: null,
                onNull: null,
              },
            },
            count: { $sum: 1 },
          },
        },
      ]),
      this.orderModel.aggregate([
        {
          $match: {
            orderDate: { $gte: startDate, $lte: endDate },
            registrationAmount: { $gt: 0 },
          },
        },
        {
          $group: {
            _id: {
              $convert: {
                input: '$counsellorId',
                to: 'string',
                onError: null,
                onNull: null,
              },
            },
            count: { $sum: 1 },
          },
        },
      ]),
      this.orderModel.aggregate([
        {
          $match: {
            orderDate: { $gte: startDate, $lte: endDate },
          },
        },
        {
          $group: {
            _id: {
              $convert: {
                input: '$counsellorId',
                to: 'string',
                onError: null,
                onNull: null,
              },
            },
            revenue: { $sum: { $ifNull: ['$countedRevenue', '$finalFee'] } },
          },
        },
      ]),
      this.taskModel.aggregate([
        {
          $match: {
            updatedAt: { $gte: startDate, $lte: endDate },
            status: 'completed',
          },
        },
        {
          $group: {
            _id: {
              $convert: {
                input: '$assignTo',
                to: 'string',
                onError: null,
                onNull: null,
              },
            },
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    const maps = {
      calls: new Map<string, number>(),
      meets: new Map<string, number>(),
      pcatDone: new Map<string, number>(),
      registrationDone: new Map<string, number>(),
      revenue: new Map<string, number>(),
      tasks: new Map<string, number>(),
    };

    for (const row of callRows) if (allow(row._id)) maps.calls.set(row._id, row.count || 0);
    for (const row of meetingRows) if (allow(row._id)) maps.meets.set(row._id, row.count || 0);
    for (const row of pcatRows) if (allow(row._id)) maps.pcatDone.set(row._id, row.count || 0);
    for (const row of registrationRows) if (allow(row._id)) maps.registrationDone.set(row._id, row.count || 0);
    for (const row of revenueRows) if (allow(row._id)) maps.revenue.set(row._id, row.revenue || 0);
    for (const row of taskRows) if (allow(row._id)) maps.tasks.set(row._id, row.count || 0);

    return maps;
  }

  private async buildDailySeries(userId: string, metric: TargetMetricKey, startDate: Date, endDate: Date) {
    const days: Date[] = [];
    for (let d = new Date(startDate); d <= endDate; d.setUTCDate(d.getUTCDate() + 1)) {
      days.push(new Date(d));
    }

    const dayMap = new Map<string, number>();
    const dayStrings = days.map((date) => {
      const value = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
      dayMap.set(value, 0);
      return value;
    });

    const matchDateField: Record<TargetMetricKey, string> = {
      calls: 'createdAt',
      meets: 'startedAt',
      pcatDone: 'pcatDoneDate',
      registrationDone: 'orderDate',
      revenue: 'orderDate',
      tasks: 'updatedAt',
    };

    const queryField = matchDateField[metric];
    const match: any = {
      [queryField]: { $gte: startDate, $lte: endDate },
    };

    if (metric === 'pcatDone') {
      match.assignedTo = new Types.ObjectId(userId);
    } else if (metric === 'registrationDone' || metric === 'revenue') {
      match.counsellorId = new Types.ObjectId(userId);
    } else if (metric === 'tasks') {
      match.assignTo = new Types.ObjectId(userId);
      match.status = 'completed';
    } else {
      match.userId = userId;
    }

    const modelByMetric: Record<TargetMetricKey, Model<any>> = {
      calls: this.callLogModel,
      meets: this.meetingLogModel,
      pcatDone: this.leadModel,
      registrationDone: this.orderModel,
      revenue: this.orderModel,
      tasks: this.taskModel,
    };

    const result = await modelByMetric[metric].aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: `$${queryField}`, timezone: 'UTC' },
          },
          value: { $sum: metric === 'revenue' ? { $ifNull: ['$countedRevenue', '$finalFee'] } : 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    for (const row of result) {
      if (dayMap.has(row._id)) {
        dayMap.set(row._id, row.value || 0);
      }
    }

    let running = 0;
    return dayStrings.map((day, index) => {
      running += dayMap.get(day) || 0;
      return {
        day: index + 1,
        date: day,
        achieved: running,
      };
    });
  }

  async upsertTarget(payload: any, currentUserId?: string) {
    if (!payload?.userId) {
      throw new BadRequestException('userId is required');
    }

    const monthKey = this.normalizeMonthKey(payload.month);
    const targets = this.normalizeTargets(payload.targets);

    return this.data.upsertByUserAndMonth(payload.userId, monthKey, {
      monthKey,
      targets,
      createdBy: currentUserId ? new Types.ObjectId(currentUserId) : payload.createdBy || undefined,
      updatedBy: currentUserId ? new Types.ObjectId(currentUserId) : payload.updatedBy || undefined,
      copiedFromMonthKey: payload.copiedFromMonthKey || null,
      copiedFromTargetId: payload.copiedFromTargetId || null,
    });
  }

  async bulkUpsert(payload: any, currentUserId?: string) {
    const monthKey = this.normalizeMonthKey(payload?.month);
    const targets = this.normalizeTargets(payload?.targets);
    let users = payload?.userIds || [];

    if (!Array.isArray(users) || !users.length) {
      const accessibleUsers = await this.getAccessibleUsers();
      users = accessibleUsers.map((user) => user.userId);
    }

    const rows = users.map((userId: string) => ({
      userId,
      monthKey,
      targets,
      createdBy: currentUserId ? new Types.ObjectId(currentUserId) : undefined,
      updatedBy: currentUserId ? new Types.ObjectId(currentUserId) : undefined,
      copiedFromMonthKey: payload?.copiedFromMonthKey || null,
      copiedFromTargetId: payload?.copiedFromTargetId || null,
    }));

    return this.data.upsertMany(rows);
  }

  async copyMonth(payload: any, currentUserId?: string) {
    const sourceMonth = this.normalizeMonthKey(payload?.sourceMonth || payload?.fromMonth);
    const targetMonth = this.normalizeMonthKey(payload?.targetMonth || payload?.month);
    const sourceRows = await this.data.findByMonth(sourceMonth);
    if (!sourceRows.length) {
      throw new NotFoundException('Source month targets not found');
    }

    const filterUserIds = Array.isArray(payload?.userIds) && payload.userIds.length ? new Set(payload.userIds.map(String)) : null;
    const rows = sourceRows
      .filter((row: any) => !filterUserIds || filterUserIds.has(String(row.userId?._id || row.userId)))
      .map((row: any) => ({
        userId: String(row.userId?._id || row.userId),
        monthKey: targetMonth,
        targets: this.normalizeTargets(row.targets),
        createdBy: currentUserId ? new Types.ObjectId(currentUserId) : undefined,
        updatedBy: currentUserId ? new Types.ObjectId(currentUserId) : undefined,
        copiedFromMonthKey: sourceMonth,
        copiedFromTargetId: row._id,
      }));

    return this.data.upsertMany(rows);
  }

  async report(month?: string) {
    const monthKey = this.normalizeMonthKey(month);
    const { startDate, endDate, currentDay, totalDays, daysLeft, isCurrentMonth } = this.getMonthMeta(monthKey);
    const accessibleUsers = await this.getAccessibleUsers();
    const userIds = accessibleUsers.map((u) => u.userId);
    const targetRows = await this.data.findByMonth(monthKey);
    const targetMap = new Map<string, any>();
    targetRows.forEach((row: any) => {
      const id = String(row.userId?._id || row.userId);
      targetMap.set(id, row);
    });

    const actualMaps = await this.buildMetricMaps(userIds, startDate, endDate);

    const users = accessibleUsers.map((user) => {
      const userId = String(user.userId);
      const target = targetMap.get(userId);
      const targets = this.normalizeTargets(target?.targets);
      const achieved = {
        calls: actualMaps.calls.get(userId) || 0,
        meets: actualMaps.meets.get(userId) || 0,
        pcatDone: actualMaps.pcatDone.get(userId) || 0,
        registrationDone: actualMaps.registrationDone.get(userId) || 0,
        revenue: actualMaps.revenue.get(userId) || 0,
        tasks: actualMaps.tasks.get(userId) || 0,
      };

      const metrics = this.metricKeys.map((metric) => {
        const targetValue = Number(targets[metric] || 0);
        const achievedValue = Number(achieved[metric] || 0);
        const remaining = Math.max(0, targetValue - achievedValue);
        const percentage = targetValue > 0 ? Math.min(100, Math.round((achievedValue / targetValue) * 100)) : 0;
        return {
          metric,
          target: targetValue,
          achieved: achievedValue,
          remaining,
          percentage,
          status: targetValue === 0 ? 'no_target' : achievedValue >= targetValue ? 'achieved' : percentage >= 75 ? 'on_track' : 'behind',
        };
      });

      return {
        userId,
        employeeId: user.employeeId,
        name: user.name,
        email: user.email,
        roleName: user.roleName,
        targetId: target?._id || null,
        monthKey,
        daysLeft: isCurrentMonth ? daysLeft : 0,
        totalDays,
        currentDay: isCurrentMonth ? currentDay : totalDays,
        metrics,
        targets,
        achieved,
        overallTarget: metrics.reduce((sum, item) => sum + (item.target || 0), 0),
        overallAchieved: metrics.reduce((sum, item) => sum + (item.achieved || 0), 0),
      };
    });

    return {
      monthKey,
      period: {
        monthKey,
        label: new Date(`${monthKey}-01T00:00:00.000Z`).toLocaleString('en-US', { month: 'long', year: 'numeric' }),
        startDate,
        endDate,
        totalDays,
        daysLeft: isCurrentMonth ? daysLeft : 0,
        currentDay: isCurrentMonth ? currentDay : totalDays,
      },
      summary: {
        totalUsers: users.length,
        totalTarget: users.reduce((sum, user) => sum + user.overallTarget, 0),
        totalAchieved: users.reduce((sum, user) => sum + user.overallAchieved, 0),
      },
      users,
    };
  }

  async revenueReport(level?: any, months?: any, month?: string) {
    const monthKeys = this.resolveMonthKeys(months, month);
    const levelNumber = this.resolveLevel(level);
    const accessibleUsers = await this.getAccessibleUsers();
    const usersForLevel = accessibleUsers.filter((user) => Number(user.level || 1) === levelNumber);
    const userIds = usersForLevel.map((user) => user.userId);

    const monthContexts = await Promise.all(
      monthKeys.map(async (monthKey) => {
        const { startDate, endDate, currentDay, totalDays, daysLeft, isCurrentMonth } = this.getMonthMeta(monthKey);
        const [targetRows, actualMaps] = await Promise.all([
          this.data.findByMonth(monthKey),
          this.buildMetricMaps(userIds, startDate, endDate),
        ]);

        const targetMap = new Map<string, any>();
        targetRows.forEach((row: any) => {
          const id = String(row.userId?._id || row.userId);
          targetMap.set(id, row);
        });

        return {
          monthKey,
          label: this.formatMonthLabel(monthKey),
          startDate,
          endDate,
          totalDays,
          daysLeft: isCurrentMonth ? daysLeft : 0,
          currentDay: isCurrentMonth ? currentDay : totalDays,
          isCurrentMonth,
          targetMap,
          actualMaps,
        };
      }),
    );

    const monthTotals = monthContexts.map((context) => ({
      monthKey: context.monthKey,
      label: context.label,
      startDate: context.startDate,
      endDate: context.endDate,
      totalDays: context.totalDays,
      daysLeft: context.daysLeft,
      currentDay: context.currentDay,
      isCurrentMonth: context.isCurrentMonth,
      target: 0,
      achieved: 0,
      remaining: 0,
      percentage: 0,
    }));

    const users = usersForLevel.map((user) => {
      const userId = String(user.userId);
      let combinedTarget = 0;
      let combinedAchieved = 0;

      const months = monthContexts.map((context, index) => {
        const targetRow = context.targetMap.get(userId);
        const targets = this.normalizeTargets(targetRow?.targets);
        const targetValue = Number(targets.revenue || 0);
        const achievedValue = Number(context.actualMaps.revenue.get(userId) || 0);
        const remaining = Math.max(0, targetValue - achievedValue);
        const percentage = targetValue > 0 ? Math.min(100, Math.round((achievedValue / targetValue) * 100)) : 0;
        const status = targetValue === 0 ? 'no_target' : achievedValue >= targetValue ? 'achieved' : percentage >= 75 ? 'on_track' : 'behind';

        monthTotals[index].target += targetValue;
        monthTotals[index].achieved += achievedValue;
        monthTotals[index].remaining = Math.max(0, monthTotals[index].target - monthTotals[index].achieved);
        monthTotals[index].percentage = monthTotals[index].target > 0
          ? Math.min(100, Math.round((monthTotals[index].achieved / monthTotals[index].target) * 100))
          : 0;

        combinedTarget += targetValue;
        combinedAchieved += achievedValue;

        return {
          monthKey: context.monthKey,
          label: context.label,
          target: targetValue,
          achieved: achievedValue,
          remaining,
          percentage,
          status,
        };
      });

      const combinedRemaining = Math.max(0, combinedTarget - combinedAchieved);
      const combinedPercentage = combinedTarget > 0 ? Math.min(100, Math.round((combinedAchieved / combinedTarget) * 100)) : 0;

      return {
        userId,
        employeeId: user.employeeId,
        name: user.name,
        email: user.email,
        roleName: user.roleName,
        level: user.level,
        months,
        combinedTarget,
        combinedAchieved,
        combinedRemaining,
        combinedPercentage,
      };
    });

    const summary = monthTotals.reduce(
      (acc, monthRow) => {
        acc.totalTarget += monthRow.target;
        acc.totalAchieved += monthRow.achieved;
        return acc;
      },
      { totalUsers: users.length, totalTarget: 0, totalAchieved: 0 },
    );

    return {
      level: levelNumber,
      months: monthTotals.map((monthRow) => ({
        ...monthRow,
        label: monthRow.label,
      })),
      summary: {
        ...summary,
        totalRemaining: Math.max(0, summary.totalTarget - summary.totalAchieved),
        totalPercentage: summary.totalTarget > 0 ? Math.min(100, Math.round((summary.totalAchieved / summary.totalTarget) * 100)) : 0,
      },
      users,
    };
  }

  async myTarget(userId: string, month?: string, metric?: TargetMetricKey) {
    const monthKey = this.normalizeMonthKey(month);
    const { startDate, endDate, currentDay, totalDays, daysLeft, isCurrentMonth } = this.getMonthMeta(monthKey);
    const user = await this.userModel.findById(userId).select('name email employeeId role createdAt').lean();
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const target = await this.data.findByUserAndMonth(userId, monthKey);
    const targets = this.normalizeTargets(target?.targets);
    const actualMaps = await this.buildMetricMaps([userId], startDate, endDate);
    const achieved = {
      calls: actualMaps.calls.get(userId) || 0,
      meets: actualMaps.meets.get(userId) || 0,
      pcatDone: actualMaps.pcatDone.get(userId) || 0,
      registrationDone: actualMaps.registrationDone.get(userId) || 0,
      revenue: actualMaps.revenue.get(userId) || 0,
      tasks: actualMaps.tasks.get(userId) || 0,
    };

    const metrics = this.metricKeys.map((key) => {
      const targetValue = Number(targets[key] || 0);
      const achievedValue = Number(achieved[key] || 0);
      return {
        metric: key,
        target: targetValue,
        achieved: achievedValue,
        remaining: Math.max(0, targetValue - achievedValue),
        percentage: targetValue > 0 ? Math.min(100, Math.round((achievedValue / targetValue) * 100)) : 0,
      };
    });

    const selectedMetric = metric && this.metricKeys.includes(metric) ? metric : this.metricKeys[0];
    const selectedTarget = Number(targets[selectedMetric] || 0);
    const selectedAchieved = Number(achieved[selectedMetric] || 0);
    const selectedSeries = await this.buildDailySeries(userId, selectedMetric, startDate, endDate);
    const targetSeries = selectedSeries.map((point) => ({
      ...point,
      target: totalDays > 0 ? Math.round((selectedTarget / totalDays) * point.day) : 0,
    }));

    return {
      monthKey,
      period: {
        monthKey,
        label: new Date(`${monthKey}-01T00:00:00.000Z`).toLocaleString('en-US', { month: 'long', year: 'numeric' }),
        startDate,
        endDate,
        totalDays,
        daysLeft: isCurrentMonth ? daysLeft : 0,
        currentDay: isCurrentMonth ? currentDay : totalDays,
      },
      user: {
        userId,
        employeeId: user.employeeId,
        name: user.name,
        email: user.email,
      },
      targetId: target?._id || null,
      daysLeft: isCurrentMonth ? daysLeft : 0,
      summary: {
        metrics,
        selectedMetric,
        target: selectedTarget,
        achieved: selectedAchieved,
        remaining: Math.max(0, selectedTarget - selectedAchieved),
        percentage: selectedTarget > 0 ? Math.min(100, Math.round((selectedAchieved / selectedTarget) * 100)) : 0,
      },
      chart: {
        metric: selectedMetric,
        labels: targetSeries.map((row) => row.date),
        target: targetSeries.map((row) => row.target),
        achieved: targetSeries.map((row) => row.achieved),
      },
    };
  }

  findById(id: string) {
    return this.data.findById(id);
  }

  update(id: string, dto: any, currentUserId?: string) {
    const payload: any = {};
    if (dto.month) payload.monthKey = this.normalizeMonthKey(dto.month);
    if (dto.targets) payload.targets = this.normalizeTargets(dto.targets);
    if (dto.userId) payload.userId = new Types.ObjectId(dto.userId);
    payload.updatedBy = currentUserId ? new Types.ObjectId(currentUserId) : undefined;
    return this.data.updateById(id, payload);
  }
}
