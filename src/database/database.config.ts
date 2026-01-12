import { MongooseModuleOptions } from '@nestjs/mongoose';

export const mongooseConfig = (): MongooseModuleOptions => ({
  uri: process.env.DATABASE_URI,
});
