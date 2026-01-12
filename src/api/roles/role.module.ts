import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Role, RoleSchema } from 'src/schema/role.schema';
import { RoleController } from './role.controller';
import { RoleLogic } from './role.logic';
import { RoleData } from './role.data';
import { RoleSeed } from './role.seed';
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Role.name, schema: RoleSchema }]),
  ],
  controllers: [RoleController],
  providers: [RoleLogic, RoleData,RoleSeed],
})
export class RoleModule {}
