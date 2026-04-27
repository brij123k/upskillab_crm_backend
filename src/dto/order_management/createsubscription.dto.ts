import { IsString, IsEmail, IsOptional, IsNumber, IsObject } from 'class-validator';

export class CreateSubscriptionDto {
  @IsString()
  orderId: string;


  @IsOptional()
  @IsString()
  planId?: string;
}