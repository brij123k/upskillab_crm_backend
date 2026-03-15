import { IsOptional } from 'class-validator';

export class GetLeadScheduleDTO {

  @IsOptional()
  leadId?: number;

  @IsOptional()
  status?: string;

  @IsOptional()
  dateFilter?: 'today' | 'custom';

  @IsOptional()
  from?: Date;

  @IsOptional()
  to?: Date;

}