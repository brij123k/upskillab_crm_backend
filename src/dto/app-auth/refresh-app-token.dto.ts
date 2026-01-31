import { ApiProperty } from '@nestjs/swagger';

export class RefreshAppTokenDto {
  @ApiProperty()
  refreshToken: string;
}
