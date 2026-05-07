import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UserLogController } from './user-log.controller';
import { UserLogData } from './user-log.data';
import { UserLogLogic } from './user-log.logic';
import { UserLog, UserLogSchema } from 'src/schema/user-log.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: UserLog.name, schema: UserLogSchema },
    ]),
  ],
  controllers: [UserLogController],
  providers: [UserLogLogic, UserLogData],
  exports: [UserLogLogic],
})
export class UserLogModule {}
