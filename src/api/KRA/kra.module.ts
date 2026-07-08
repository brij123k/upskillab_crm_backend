import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { KraController } from './kra.controller';
import { KraLogic } from './kra.logic';
import { KraData } from './kra.data';
import { Kra, KraSchema } from 'src/schema/kra.schema';
import { CallLog, CallLogSchema } from 'src/schema/call-log.schema';
import { LeadHistory, LeadHistorySchema } from 'src/schema/lead_management/lead-history.schema';
import { User, UserSchema } from 'src/schema/user.schema';
import { Role, RoleSchema } from 'src/schema/role.schema';
import { LeadStageHistoryModule } from '../lead_management/LeadStageHistory/LeadStageHistory.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Kra.name, schema: KraSchema },
      { name: CallLog.name, schema: CallLogSchema },
      { name: LeadHistory.name, schema: LeadHistorySchema },
      { name: User.name, schema: UserSchema },
      { name: Role.name, schema: RoleSchema },
    ]),
    LeadStageHistoryModule,
  ],
  controllers: [KraController],
  providers: [KraLogic, KraData],
  exports: [KraLogic],
})
export class KraModule {}
