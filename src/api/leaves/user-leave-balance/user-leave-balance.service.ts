import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { User } from 'src/schema/user.schema';
import { LeavePolicy } from 'src/schema/leave-policy.schema';
import { UserLeaveBalance } from 'src/schema/user-leave-balance.schema';

@Injectable()
export class UserLeaveBalanceService {
  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<User>,

    @InjectModel(LeavePolicy.name)
    private readonly leavePolicyModel: Model<LeavePolicy>,

    @InjectModel(UserLeaveBalance.name)
    private readonly balanceModel: Model<UserLeaveBalance>,
  ) {}

  /* -------------------------------------------------------------------------- */
  /*                                  Helpers                                   */
  /* -------------------------------------------------------------------------- */

  private currentYear() {
    return new Date().getFullYear();
  }

  private currentMonth() {
    return new Date().getMonth() + 1;
  }

  private async createMissingBalances(
    year: number,
    month: number,
){
  const users = await this.userModel
.find({
    status: "active",
})
.populate('role');

for(const user of users){
  const balance = await this.balanceModel.findOne({
    userId:user._id,
    year,
});
if(balance){
  continue;
}
console.log(user.role._id,year)
const policy = await this.leavePolicyModel.findOne({
    roleId:user.role._id,
    year,
    isActive:true,
});
if(!policy){
  continue;
}
await this.balanceModel.create({

    userId:user._id,

    roleId:user.role,

    year,

    availableCL:policy.monthlyCL,

    availableEL:policy.monthlyEL,

    carriedForwardEL:0,

    encashedEL:0,

    lastCreditedMonth:month,

    yearClosed:false,

    isActive:true,
});
}
}
  /* -------------------------------------------------------------------------- */
  /*                           Current User Balance                             */
  /* -------------------------------------------------------------------------- */

  async getCurrentBalance(
    userId: string,
    year: number = this.currentYear(),
  ) {
    return this.balanceModel
      .findOne({
        userId: new Types.ObjectId(userId),
        year,
      })
      .populate('userId', 'name employeeId role')
      .populate('roleId', 'name');
  }

  /* -------------------------------------------------------------------------- */
  /*                              Ensure Balance                                */
  /* -------------------------------------------------------------------------- */

  async ensureBalance(
    userId: string,
    year: number = this.currentYear(),
  ) {
    let balance = await this.getCurrentBalance(
      userId,
      year,
    );

    if (balance) {
      return balance;
    }

    return this.createYearBalance(
      userId,
      year,
    );
  }

  /* -------------------------------------------------------------------------- */
  /*                           Create Year Balance                              */
  /* -------------------------------------------------------------------------- */

  async createYearBalance(
    userId: string,
    year: number,
  ) {
    const user = await this.userModel
      .findById(userId)
      .populate('role');

    if (!user) {
      throw new NotFoundException(
        'User not found',
      );
    }

    const roleId =
      user.role?._id?.toString() ||
      user.role?.toString();

    if (!roleId) {
      throw new BadRequestException(
        'User role not found',
      );
    }

    const policy =
      await this.leavePolicyModel.findOne({
        roleId: new Types.ObjectId(roleId),
        year,
        isActive: true,
      });

    if (!policy) {
      throw new BadRequestException(
        `Leave policy not found for ${year}`,
      );
    }

    const existing =
      await this.balanceModel.findOne({
        userId: user._id,
        year,
      });

    if (existing) {
      return existing;
    }

    /**
     * First year balance
     *
     * CL starts with policy amount
     * EL starts with policy amount
     */

    const balance =
      await this.balanceModel.create({
        userId: user._id,

        roleId: roleId,

        year,

        availableCL: policy.monthlyCL,

        availableEL: policy.monthlyEL,

        carriedForwardEL: 0,

        encashedEL: 0,

        lastCreditedMonth: this.currentMonth(),

        yearClosed: false,

        isActive: true,
      });

    return balance.populate([
      {
        path: 'userId',
        select: 'name employeeId role',
      },
      {
        path: 'roleId',
        select: 'name',
      },
    ]);
  }
/* -------------------------------------------------------------------------- */
/*                     Monthly Leave Credit (Cron Job)                         */
/* -------------------------------------------------------------------------- */

async creditMonthlyLeaves(
  year: number = this.currentYear(),
  month: number = this.currentMonth(),
) {
  await this.createMissingBalances(
    year,
    month,
);
  if (month < 1 || month > 12) {
    throw new BadRequestException('Invalid month.');
  }

  if (month === 1) {
    return {
      success: true,
      message: 'January balance will be created by yearly cron.',
    };
  }

  const balances = await this.balanceModel.find({
    year,
    isActive: true,
  });

const updatedBalances:any[] = [];

  for (const balance of balances) {
    /**
     * Already credited
     */
    if (balance.lastCreditedMonth >= month) {
      continue;
    }

    /**
     * Missed Months
     *
     * Example
     *
     * Current Month = 10
     *
     * Last Credit = 7
     *
     * Missed = 3
     */
    const missedMonths =
      month - balance.lastCreditedMonth;

    if (missedMonths <= 0) {
      continue;
    }

    const user = await this.userModel
      .findById(balance.userId)
      .populate('role');

    if (!user) {
      continue;
    }

    const roleId =
      user.role?._id?.toString() ||
      user.role?.toString();

    if (!roleId) {
      continue;
    }

    /**
     * Latest Policy
     */
    const policy =
      await this.leavePolicyModel.findOne({
        roleId: new Types.ObjectId(roleId),
        year,
        isActive: true,
      });

    if (!policy) {
      continue;
    }

    /**
     * User role changed?
     */
    if (
      balance.roleId.toString() !== roleId
    ) {
      balance.roleId =
        new Types.ObjectId(roleId);
    }

    /**
     * Credit missed months
     */

    balance.availableCL +=
      policy.monthlyCL * missedMonths;

    balance.availableEL +=
      policy.monthlyEL * missedMonths;

    balance.lastCreditedMonth = month;

    await balance.save();

    updatedBalances.push({
      userId: balance.userId,
      creditedMonths: missedMonths,
      availableCL: balance.availableCL,
      availableEL: balance.availableEL,
    });
  }

  return {
    success: true,
    totalUpdated: updatedBalances.length,
    data: updatedBalances,
  };
}
/* -------------------------------------------------------------------------- */
/*                      Year End Carry Forward Cron                           */
/* -------------------------------------------------------------------------- */

async carryForwardToNextYear(
  currentYear: number = this.currentYear(),
) {
  const previousYear = currentYear - 1;

  const previousBalances = await this.balanceModel.find({
    year: previousYear,
    isActive: true,
    yearClosed: false,
  });

  const createdBalances: UserLeaveBalance[] = [];

  for (const previousBalance of previousBalances) {

    /**
     * Already created?
     */
    const exists = await this.balanceModel.findOne({
      userId: previousBalance.userId,
      year: currentYear,
    });

    if (exists) {
      continue;
    }

    /**
     * Latest User
     */
    const user = await this.userModel
      .findById(previousBalance.userId)
      .populate('role');

    if (!user) {
      continue;
    }

    const roleId =
      user.role?._id?.toString() ||
      user.role?.toString();

    if (!roleId) {
      continue;
    }

    /**
     * Current Year's Policy
     */
    const policy =
      await this.leavePolicyModel.findOne({
        roleId: new Types.ObjectId(roleId),
        year: currentYear,
        isActive: true,
      });

    if (!policy) {
      continue;
    }

    /**
     * Carry Forward EL
     */

    let carryForwardEL = 0;

    if (policy.allowEarnedLeaveCarryForward) {

      carryForwardEL =
        previousBalance.availableEL;

      if (
        policy.maxCarryForwardEL > 0 &&
        carryForwardEL >
          policy.maxCarryForwardEL
      ) {
        carryForwardEL =
          policy.maxCarryForwardEL;
      }
    }

    /**
     * January Balance
     */

    const newBalance =
      await this.balanceModel.create({

        userId: user._id,

        roleId: new Types.ObjectId(roleId),

        year: currentYear,

        /**
         * CL Reset
         */

        availableCL:
          policy.monthlyCL,

        /**
         * EL
         */

        availableEL:
          carryForwardEL +
          policy.monthlyEL,

        carriedForwardEL:
          carryForwardEL,

        encashedEL: 0,

        lastCreditedMonth: 1,

        yearClosed: false,

        isActive: true,
      });

    /**
     * Close Previous Year
     */

    previousBalance.yearClosed = true;

    await previousBalance.save();

    createdBalances.push(newBalance);
  }

  return {

    success: true,

    totalUsers:
      createdBalances.length,

    data: createdBalances,
  };
}
/* -------------------------------------------------------------------------- */
/*                              Deduct Leave                                  */
/* -------------------------------------------------------------------------- */

async deductLeave(
  userId: string,
  leaveType: 'CL' | 'EL',
  days: number,
) {
  const balance = await this.ensureBalance(userId);

  if (!balance) {
    throw new NotFoundException('Leave balance not found.');
  }

  if (days <= 0) {
    throw new BadRequestException(
      'Leave days should be greater than 0.',
    );
  }

  if (leaveType === 'CL') {
    if (balance.availableCL < days) {
      throw new BadRequestException(
        'Insufficient Casual Leave balance.',
      );
    }

    balance.availableCL -= days;
  } else {
    if (balance.availableEL < days) {
      throw new BadRequestException(
        'Insufficient Earned Leave balance.',
      );
    }

    balance.availableEL -= days;
  }

  await balance.save();

  return balance;
}

/* -------------------------------------------------------------------------- */
/*                              Restore Leave                                 */
/* -------------------------------------------------------------------------- */

async restoreLeave(
  userId: string,
  leaveType: 'CL' | 'EL',
  days: number,
) {
  const balance = await this.ensureBalance(userId);

  if (!balance) {
    throw new NotFoundException(
      'Leave balance not found.',
    );
  }

  if (days <= 0) {
    throw new BadRequestException(
      'Leave days should be greater than 0.',
    );
  }

  if (leaveType === 'CL') {
    balance.availableCL += days;
  } else {
    balance.availableEL += days;
  }

  await balance.save();

  return balance;
}

/* -------------------------------------------------------------------------- */
/*                           Encash Earned Leave                              */
/* -------------------------------------------------------------------------- */

async encashEarnedLeave(
  userId: string,
  days: number,
) {
  const balance = await this.ensureBalance(userId);

  if (!balance) {
    throw new NotFoundException(
      'Leave balance not found.',
    );
  }

  if (days <= 0) {
    throw new BadRequestException(
      'Invalid leave days.',
    );
  }

  if (balance.availableEL < days) {
    throw new BadRequestException(
      'Insufficient Earned Leave balance.'
    );
  }

  balance.availableEL -= days;

  balance.encashedEL += days;

  await balance.save();

  return {
    success: true,
    message: `${days} EL encashed successfully.`,
    data: balance,
  };
}

/* -------------------------------------------------------------------------- */
/*                         Balance Summary                                    */
/* -------------------------------------------------------------------------- */

async getBalanceSummary(
  userId: string,
  year: number = this.currentYear(),
) {
  const balance = await this.ensureBalance(
    userId,
    year,
  );

  return {
    year: balance.year,

    availableCL: balance.availableCL,

    availableEL: balance.availableEL,

    carriedForwardEL:
      balance.carriedForwardEL,

    encashedEL:
      balance.encashedEL,

    lastCreditedMonth:
      balance.lastCreditedMonth,
  };
}

/* -------------------------------------------------------------------------- */
/*                           Balance History                                  */
/* -------------------------------------------------------------------------- */

async getBalanceHistory(
  userId: string,
) {
  return this.balanceModel
    .find({
      userId: new Types.ObjectId(userId),
    })
    .sort({
      year: -1,
    });
}

async getAllBalances(query: any = {}) {
  const filter: any = {};

  if (query.year) {
    filter.year = Number(query.year);
  }

  if (query.roleId) {
    filter.roleId = new Types.ObjectId(query.roleId);
  }

  if (query.userId) {
    filter.userId = new Types.ObjectId(query.userId);
  }

  return this.balanceModel
    .find(filter)
    .populate('userId', 'name employeeId role')
    .populate('roleId', 'name')
    .sort({
      year: -1,
      createdAt: -1,
    });
}
}