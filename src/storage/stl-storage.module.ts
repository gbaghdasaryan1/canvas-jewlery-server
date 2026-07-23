import { Module } from '@nestjs/common';
import { StlStorageService } from './stl-storage.service';

@Module({
  providers: [StlStorageService],
  exports: [StlStorageService],
})
export class StlStorageModule {}
