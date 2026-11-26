import {
  S3Client,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';

@Injectable()
export class FileUploaderService {
  private readonly s3 = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey:
        process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });

  async uploadProfileImage(
    file: Express.Multer.File,
  ) {
    const extension =
      file.originalname.split('.').pop();

    const fileName = `crm/profile/${Date.now()}-${randomUUID()}.${extension}`;

    await this.s3.send(
      new PutObjectCommand({
        Bucket: process.env.AWS_S3_BUCKET,
        Key: fileName,
        Body: file.buffer,
        ContentType: file.mimetype,
      }),
    );

    return {
      fileName,
      url: `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`,
    };
  }

  /** Any document (PDF, image, Word …) under crm/<folder>/. */
  async uploadFile(file: Express.Multer.File, folder: string) {
    const extension = (file.originalname.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
    const safeFolder = folder.replace(/[^a-z0-9/_-]/gi, '') || 'files';
    const fileName = `crm/${safeFolder}/${Date.now()}-${randomUUID()}.${extension}`;

    await this.s3.send(
      new PutObjectCommand({
        Bucket: process.env.AWS_S3_BUCKET,
        Key: fileName,
        Body: file.buffer,
        ContentType: file.mimetype,
      }),
    );

    return {
      fileName,
      originalName: file.originalname,
      url: `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`,
    };
  }
}