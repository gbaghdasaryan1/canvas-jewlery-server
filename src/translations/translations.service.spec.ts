import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TranslationsService } from './translations.service';
import { Locale } from './entities/locale.entity';
import { Translation } from './entities/translation.entity';

function locale(overrides: Partial<Locale> = {}): Locale {
  return {
    code: 'en',
    label: 'ENG',
    nativeName: 'English',
    sortOrder: 2,
    enabled: true,
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as Locale;
}

function row(
  localeCode: string,
  key: string,
  value: string,
  updatedAt = new Date('2026-01-01T00:00:00Z'),
): Translation {
  return { id: `${localeCode}:${key}`, localeCode, key, value, updatedAt } as Translation;
}

const LOCALES = [
  locale({ code: 'hy', label: 'ՀԱՅ', nativeName: 'Հայերեն', sortOrder: 0 }),
  locale({ code: 'ru', label: 'РУС', nativeName: 'Русский', sortOrder: 1 }),
  locale({ code: 'en', label: 'ENG', nativeName: 'English', sortOrder: 2 }),
];

describe('TranslationsService', () => {
  let service: TranslationsService;
  let translationRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
  };
  let localeRepo: { find: jest.Mock; exists: jest.Mock };

  beforeEach(async () => {
    translationRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((entity: unknown) => entity),
      save: jest.fn((entity: unknown) => Promise.resolve(entity)),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    localeRepo = {
      find: jest.fn().mockResolvedValue(LOCALES),
      exists: jest.fn().mockResolvedValue(true),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        TranslationsService,
        { provide: getRepositoryToken(Translation), useValue: translationRepo },
        { provide: getRepositoryToken(Locale), useValue: localeRepo },
      ],
    }).compile();

    service = moduleRef.get(TranslationsService);
  });

  describe('getPublicBundle', () => {
    it('groups rows by locale and reports the newest updatedAt as version', async () => {
      const newest = new Date('2026-03-05T12:00:00Z');
      translationRepo.find.mockResolvedValue([
        row('en', 'hero.title.l1', 'Every moment'),
        row('hy', 'hero.title.l1', 'Ամեն պահ', newest),
        row('ru', 'promos.0', 'Промо'),
      ]);

      const bundle = await service.getPublicBundle();

      expect(bundle.version).toBe(newest.getTime());
      expect(bundle.resources.en['hero.title.l1']).toBe('Every moment');
      expect(bundle.resources.hy['hero.title.l1']).toBe('Ամեն պահ');
      expect(bundle.resources.ru['promos.0']).toBe('Промо');
      // Locales come through ordered by sortOrder for the switcher.
      expect(bundle.locales.map((l) => l.code)).toEqual(['hy', 'ru', 'en']);
    });

    it('drops rows for locales that are no longer enabled', async () => {
      localeRepo.find.mockResolvedValue([LOCALES[2]]); // en only
      translationRepo.find.mockResolvedValue([
        row('en', 'nav.home', 'Home'),
        row('hy', 'nav.home', 'Գլխավոր'),
      ]);

      const bundle = await service.getPublicBundle();

      expect(Object.keys(bundle.resources)).toEqual(['en']);
      expect(bundle.resources.en['nav.home']).toBe('Home');
    });
  });

  describe('listForAdmin', () => {
    beforeEach(() => {
      translationRepo.find.mockResolvedValue([
        row('en', 'nav.home', 'Home'),
        row('hy', 'nav.home', 'Գլխավոր'),
        row('ru', 'nav.home', 'Домой'),
        row('en', 'nav.faq', 'FAQ'),
        // nav.faq missing hy and ru
      ]);
    });

    it('pivots rows into key×locale and orders keys naturally', async () => {
      const result = await service.listForAdmin({});
      const home = result.keys.find((k) => k.key === 'nav.home');
      expect(home?.values).toEqual({ en: 'Home', hy: 'Գլխավոր', ru: 'Домой' });
      expect(result.keys.map((k) => k.key)).toEqual(['nav.faq', 'nav.home']);
    });

    it('missing=true keeps only keys lacking an enabled locale', async () => {
      const result = await service.listForAdmin({ missing: true });
      expect(result.keys.map((k) => k.key)).toEqual(['nav.faq']);
    });

    it('search matches on key or any value, case-insensitively', async () => {
      const byValue = await service.listForAdmin({ search: 'домой' });
      expect(byValue.keys.map((k) => k.key)).toEqual(['nav.home']);

      const byKey = await service.listForAdmin({ search: 'faq' });
      expect(byKey.keys.map((k) => k.key)).toEqual(['nav.faq']);
    });

    it('sorts numeric path segments numerically, not lexically', async () => {
      translationRepo.find.mockResolvedValue([
        row('en', 'promos.10', 'k'),
        row('en', 'promos.2', 'b'),
        row('en', 'promos.1', 'a'),
      ]);
      const result = await service.listForAdmin({});
      expect(result.keys.map((k) => k.key)).toEqual([
        'promos.1',
        'promos.2',
        'promos.10',
      ]);
    });
  });

  describe('upsertValue', () => {
    it('updates an existing row so updatedAt bumps via save()', async () => {
      const existing = row('en', 'nav.home', 'Old');
      translationRepo.findOne.mockResolvedValue(existing);

      await service.upsertValue({ locale: 'en', key: 'nav.home', value: 'New' });

      expect(existing.value).toBe('New');
      expect(translationRepo.save).toHaveBeenCalledWith(existing);
      expect(translationRepo.create).not.toHaveBeenCalled();
    });

    it('creates a new row when the (locale,key) pair is absent', async () => {
      translationRepo.findOne.mockResolvedValue(null);

      await service.upsertValue({ locale: 'en', key: 'nav.new', value: 'Hi' });

      expect(translationRepo.create).toHaveBeenCalledWith({
        localeCode: 'en',
        key: 'nav.new',
        value: 'Hi',
      });
      expect(translationRepo.save).toHaveBeenCalled();
    });

    it('rejects an unknown locale', async () => {
      localeRepo.exists.mockResolvedValue(false);
      await expect(
        service.upsertValue({ locale: 'zz', key: 'nav.home', value: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('createKey', () => {
    it('upserts a value per provided locale and returns the row', async () => {
      translationRepo.findOne.mockResolvedValue(null);
      translationRepo.find.mockResolvedValue([
        row('en', 'demo.key', 'Hi'),
        row('hy', 'demo.key', 'Ողջույն'),
      ]);

      const result = await service.createKey({
        key: 'demo.key',
        values: { en: 'Hi', hy: 'Ողջույն' },
      });

      expect(translationRepo.save).toHaveBeenCalledTimes(2);
      expect(result).toEqual({
        key: 'demo.key',
        values: { en: 'Hi', hy: 'Ողջույն' },
      });
    });

    it('rejects a non-string or oversized value before any DB write', async () => {
      await expect(
        service.createKey({
          key: 'demo.key',
          values: { en: 'x'.repeat(9000) },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(translationRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('deleteKey', () => {
    it('deletes every locale row for the key and returns the count', async () => {
      translationRepo.delete.mockResolvedValue({ affected: 3 });
      const result = await service.deleteKey('nav.home');
      expect(translationRepo.delete).toHaveBeenCalledWith({ key: 'nav.home' });
      expect(result).toEqual({ deleted: 3 });
    });
  });
});
