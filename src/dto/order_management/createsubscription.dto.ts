import { IsString, IsEmail, IsOptional, IsNumber, IsObject } from 'class-validator';

export class CreateSubscriptionDto {
  @IsString()
  orderId: string;


  @IsOptional()
  @IsString()
  planId?: string;

  @IsOptional()
  @IsNumber()
  amount?: number;

  @IsString({ each: true })
  payment_methods: string[]; // ["upi"] or ["enach"]

  @IsObject()
  payment_details: {
    // BANK (enach/pnach)
    accountNumber?: string;
    ifsc?: string;
    bankCode?: string;
    accountType?: string;
    accountHolderName?: string;

    // UPI
    upiId?: string;

    // CARD
    cardNumber?: string;
    cardExpiry?: string;
    cardCvv?: string;
  };

}