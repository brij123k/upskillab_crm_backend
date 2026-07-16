import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { UserLeaveBalanceService } from './user-leave-balance.service';

@Injectable()
export class UserLeaveBalanceCron {
  private readonly logger = new Logger(UserLeaveBalanceCron.name);

  constructor(
    private readonly leaveBalanceService: UserLeaveBalanceService,
  ) {}

  /**
   * Runs on 1st day of every month at 12:05 AM
   */
  @Cron('0 5 0 1 * *')
  async monthlyLeaveCredit() {
    try {
      this.logger.log(
        'Starting Monthly Leave Credit...',
      );

      const result =
        await this.leaveBalanceService.creditMonthlyLeaves();

      this.logger.log(
        `Monthly Leave Credit Completed. Updated ${result.totalUpdated} users.`,
      );
    } catch (error) {
      this.logger.error(
        'Monthly Leave Credit Failed',
        error.stack,
      );
    }
  }

  /**
   * Runs every year on January 1st at 12:10 AM
   */
  @Cron('0 10 0 1 1 *')
  async yearlyCarryForward() {
    try {
      this.logger.log(
        'Starting Yearly Carry Forward...',
      );

      const result =
        await this.leaveBalanceService.carryForwardToNextYear();

      this.logger.log(
        `Yearly Carry Forward Completed. Created ${result.totalUsers} balances.`,
      );
    } catch (error) {
      this.logger.error(
        'Yearly Carry Forward Failed',
        error.stack,
      );
    }
  }
}