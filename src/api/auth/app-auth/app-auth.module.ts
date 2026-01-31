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
import { UserModule } from 'src/api/user/user.module';
import { ProfileModule } from 'src/api/profile/profile.module';

@Module({
  imports: [
    JwtModule.register({ secret: 'JWT_SECRET_KEY' }),
    MongooseModule.forFeature([
      { name: AppAuthToken.name, schema: AppAuthTokenSchema },
      {
        name: UserAppHistory.name,
        schema: UserAppHistorySchema,
      },
    ]),
    UserModule,
    ProfileModule,
  ],
  controllers: [AppAuthController],
  providers: [
    AppAuthLogic,
    AppAuthData,
    UserAppHistoryData,
  ],
})
export class AppAuthModule {}
