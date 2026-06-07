import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsIn, IsMongoId } from 'class-validator';

export class UserActivityReportQueryDto {
  @ApiPropertyOptional({ enum: ['today', 'week', 'month', 'year'] })
  @IsOptional()
  @IsString()
  @IsIn(['today', 'week', 'month', 'year'])
  dateFilter?: string;

  @ApiPropertyOptional({ description: 'Custom from date in ISO format' })
  @IsOptional()
  @IsString()
  fromDate?: string;

  @ApiPropertyOptional({ description: 'Custom to date in ISO format' })
  @IsOptional()
  @IsString()
  toDate?: string;

  @ApiPropertyOptional({ description: 'Optional user id to filter the report for a single user' })
  @IsOptional()
  @IsMongoId()
  userId?: string;
}
