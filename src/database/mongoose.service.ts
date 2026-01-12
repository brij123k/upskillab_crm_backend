import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Connection } from 'mongoose';
import { InjectConnection } from '@nestjs/mongoose';

@Injectable()
export class MongooseService implements OnModuleInit {
  private readonly logger = new Logger('MongoDB');

  constructor(
    @InjectConnection()
    private readonly connection: Connection,
  ) {}

  onModuleInit() {
    if (this.connection.readyState === 1) {
      this.logger.log('MongoDB connected successfully');
    } else {
      this.logger.error('MongoDB connection failed');
    }
  }
}
