import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Role, RoleSchema } from 'src/schema/role.schema';
import { RoleController } from './role.controller';
import { RoleLogic } from './role.logic';
import { RoleData } from './role.data';
import { RoleSeed } from './role.seed';
import { LevelModule } from '../level/level.module';
import {
  Level,
  LevelSchema,
} from 'src/schema/level.schema';
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Role.name, schema: RoleSchema },
      { name: Level.name, schema: LevelSchema }
    ]),
    LevelModule,
  ],

  controllers: [RoleController],
  providers: [RoleLogic, RoleData,RoleSeed],
})
export class RoleModule {}
