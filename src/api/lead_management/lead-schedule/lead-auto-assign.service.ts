import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { Lead } from 'src/schema/lead_management/lead.schema';
import { LeadStage } from 'src/schema/lead_management/lead-stage.schema';
import { User } from 'src/schema/user.schema';

@Injectable()
export class LeadAutoAssignService {
  private readonly logger = new Logger(
    LeadAutoAssignService.name,
  );

  constructor(
    @InjectModel(Lead.name)
    private readonly leadModel: Model<Lead>,

    @InjectModel(LeadStage.name)
    private readonly leadStageModel: Model<LeadStage>,

    @InjectModel(User.name)
    private readonly userModel: Model<User>,
  ) {}

  // Testing: Every Minute
//   @Cron('* * * * *')

  // Production:
  @Cron('0 0 */6 * * *')

  async reassignLostLeads() {
    try {
      this.logger.log(
        'Checking Lost / Not Interested leads...',
      );

      const stages = await this.leadStageModel.find({
        name: {
          $in: ['Lost', 'Not Interested'],
        },
      });

      if (!stages.length) {
        this.logger.log('No matching stages found');
        return;
      }

      const stageIds = stages.map((s) => s._id);

      const now = new Date();

      const sixHoursAgo = new Date(
        now.getTime() - 6 * 60 * 60 * 1000,
      );

      const adminUser = await this.userModel.findOne({
        role: '696f88b60841bc5572ee2385',
      });

      if (!adminUser) {
        this.logger.error('Admin user not found');
        return;
      }

      const leads = await this.leadModel.find({
        stageId: { $in: stageIds },

        // Changed during last 6 hours
        stageChangedAt: {
          $gte: sixHoursAgo,
          $lte: now,
        },
      });

      this.logger.log(
        `Found ${leads.length} leads to reassign`,
      );

      if (!leads.length) return;

      const result = await this.leadModel.updateMany(
        {
          _id: {
            $in: leads.map((lead) => lead._id),
          },
        },
        {
          $set: {
            assignedTo: adminUser._id,
            assignedDate: new Date(),
            modifiedAt: new Date(),
          },
        },
      );

      this.logger.log(
        `${result.modifiedCount} leads reassigned to Admin`,
      );
    } catch (error) {
      console.error(error);
      this.logger.error(error);
    }
  }
}