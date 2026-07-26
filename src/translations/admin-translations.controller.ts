import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { StaffApiKeyGuard } from '../orders/staff-api-key.guard';
import { CreateKeyDto } from './dto/create-key.dto';
import { ListTranslationsQueryDto } from './dto/list-translations-query.dto';
import { UpsertTranslationDto } from './dto/upsert-translation.dto';
import {
  AdminKeyRow,
  AdminListResult,
  LocaleView,
  TranslationsService,
} from './translations.service';

/**
 * Staff-only translation management, gated by the same x-api-key guard as the
 * orders dashboard. Backs the admin's key×locale editor.
 */
@Controller('admin/translations')
@UseGuards(StaffApiKeyGuard)
export class AdminTranslationsController {
  constructor(private readonly translationsService: TranslationsService) {}

  @Get()
  list(@Query() query: ListTranslationsQueryDto): Promise<AdminListResult> {
    return this.translationsService.listForAdmin(query);
  }

  @Get('locales')
  locales(): Promise<LocaleView[]> {
    return this.translationsService.listLocales();
  }

  /** Create a key, optionally with values for one or more locales. */
  @Post()
  create(@Body() body: CreateKeyDto): Promise<AdminKeyRow> {
    return this.translationsService.createKey(body);
  }

  /** Set one locale's value for one key (create or overwrite). */
  @Patch()
  async upsert(
    @Body() body: UpsertTranslationDto,
  ): Promise<{ locale: string; key: string; value: string }> {
    const row = await this.translationsService.upsertValue(body);
    return { locale: row.localeCode, key: row.key, value: row.value };
  }

  /** Delete a key across every locale. */
  @Delete()
  remove(@Query('key') key: string): Promise<{ deleted: number }> {
    return this.translationsService.deleteKey(key);
  }
}
