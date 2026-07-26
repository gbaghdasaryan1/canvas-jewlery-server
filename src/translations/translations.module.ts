import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminTranslationsController } from './admin-translations.controller';
import { Locale } from './entities/locale.entity';
import { Translation } from './entities/translation.entity';
import { TranslationsController } from './translations.controller';
import { TranslationsService } from './translations.service';

@Module({
  imports: [TypeOrmModule.forFeature([Translation, Locale])],
  controllers: [TranslationsController, AdminTranslationsController],
  providers: [TranslationsService],
})
export class TranslationsModule {}
