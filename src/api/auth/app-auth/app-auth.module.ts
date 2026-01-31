import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import {
  AppAuthToken,
  AppAuthTokenSchema,
} from 'src/schema/App_management/app-auth-token.schema';
import {
  UserAppHistory,
  UserAppHistorySchema,
} from 'src/schema/App_management/user-app-history.schema';
import { AppAuthController } from './app-auth.controller';
import { AppAuthLogic } from './app-auth.logic';
import { AppAuthData } from './app-auth.data';
import { UserAppHistoryData } from './user-app-history.data';

@Module({
  imports: [
    JwtModule.register({ secret: 'APP_JWT_SECRET' }),
    MongooseModule.forFeature([
      { name: AppAuthToken.name, schema: AppAuthTokenSchema },
      {
        name: UserAppHistory.name,
        schema: UserAppHistorySchema,
      },
    ]),
  ],
  controllers: [AppAuthController],
  providers: [
    AppAuthLogic,
    AppAuthData,
    UserAppHistoryData,
  ],
})
export class AppAuthModule {}
