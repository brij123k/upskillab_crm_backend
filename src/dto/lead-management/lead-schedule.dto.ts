import { IsNumber, IsDateString } from 'class-validator';

export class CreateLeadScheduleDTO {
  @IsNumber()
  leadId: number;

  @IsDateString()
  scheduledAt: Date;
}
