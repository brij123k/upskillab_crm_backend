import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DepartmentController } from './department.controller';
import { DepartmentLogic } from './department.logic';
import { DepartmentData } from './department.data';
import {
  Department,
  DepartmentSchema,
} from 'src/schema/department.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Department.name, schema: DepartmentSchema },
    ]),
  ],
  controllers: [DepartmentController],
  providers: [DepartmentLogic, DepartmentData],
})
export class DepartmentModule {}
