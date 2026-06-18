import { IsNotEmpty, IsString } from 'class-validator';
import { PartialType } from '@nestjs/swagger';
export class CreateLevelDto {
  @IsString()
  @IsNotEmpty()
  name: string;
}

export class UpdateLevelDto extends PartialType(
  CreateLevelDto,
) {}