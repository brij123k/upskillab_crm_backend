import { IsString, IsOptional, IsMongoId } from 'class-validator';

export class CreateSubscriptionDto {
  @IsString()
  orderId: string;

  /** Order.subscriptions[] entry to link (required when the order has several plans). */
  @IsOptional()
  @IsMongoId()
  subscriptionEntryId?: string;

  @IsOptional()
  @IsString()
  planId?: string;
}
