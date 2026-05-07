import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { TaskStatus } from 'src/schema/task.schema';

export class CreateTaskDto {
  @ApiProperty()
  @IsString()
  title: string;

  @ApiProperty()
  @IsString()
  description: string;

  @ApiProperty()
  @IsString()
  assignTo: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  assignedBy?: string;

  @ApiProperty()
  @IsDateString()
  dueDate: string;

  @ApiProperty({ required: false, type: [Number] })
  @IsOptional()
  @IsArray()
  @Type(() => Number)
  reletedLeadIds?: number[];

  @ApiProperty({ required: false, enum: TaskStatus })
  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;
}
