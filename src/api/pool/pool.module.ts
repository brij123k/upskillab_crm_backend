import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PoolController } from './pool.controller';
import { PoolService } from './pool.service';
import { Pool, PoolSchema, } from 'src/schema/Pool.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Pool.name, schema: PoolSchema },
    ]),
  ],
  controllers: [PoolController],
  providers: [PoolService],
  exports: [PoolService],
})
export class PoolModule {}
