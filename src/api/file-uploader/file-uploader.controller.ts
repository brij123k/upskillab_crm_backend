import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';

import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import { FileUploaderService } from './file-uploader.service';

@ApiTags('CRM Profile Upload')
@Controller('profile-upload')
export class ProfileUploadController {
  constructor(
    private readonly fileUploaderService: FileUploaderService,
  ) {}

  @Post('image')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  async uploadProfileImage(
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException(
        'Image file is required',
      );
    }

    const allowedTypes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
    ];

    if (
      !allowedTypes.includes(file.mimetype)
    ) {
      throw new BadRequestException(
        'Only JPG, PNG and WEBP images are allowed',
      );
    }

    const uploaded =
      await this.fileUploaderService.uploadProfileImage(
        file,
      );

    return {
      success: true,
      message:
        'Profile image uploaded successfully',
      data: uploaded,
    };
  }
}