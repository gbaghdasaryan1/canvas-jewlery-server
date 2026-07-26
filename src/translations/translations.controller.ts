import { Controller, Get } from '@nestjs/common';
import { PublicBundle, TranslationsService } from './translations.service';

/**
 * Public, unauthenticated read of the whole translation bundle. The client
 * fetches this once, un-flattens it, and stores it. Throttled by the global
 * ThrottlerGuard like every other route.
 */
@Controller('translations')
export class TranslationsController {
  constructor(private readonly translationsService: TranslationsService) {}

  @Get()
  getBundle(): Promise<PublicBundle> {
    return this.translationsService.getPublicBundle();
  }
}
