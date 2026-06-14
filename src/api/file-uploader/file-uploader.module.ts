import { Module } from '@nestjs/common';

import { ProfileUploadController } from './file-uploader.controller';
import { FileUploaderService } from './file-uploader.service';

@Module({
  controllers: [ProfileUploadController],
  providers: [FileUploaderService],
  exports: [FileUploaderService],
})
export class ProfileUploadModule {}