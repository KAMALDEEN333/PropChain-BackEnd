import { Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createReadStream } from 'fs';

@Controller('files')
export class FilesController {
  @Post('upload')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    storage: multer.memoryStorage(), // stream into memory
  }))
  async uploadFile(@UploadedFile() file: Express.Multer.File) {
    // Stream file content instead of loading fully
    const stream = createReadStream(file.path);
    // Process stream (e.g., pipe to S3, database, etc.)
    return { filename: file.originalname, size: file.size };
  }
}
