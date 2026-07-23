import { buildCorsOptions } from './cors.config';

describe('buildCorsOptions', () => {
  describe('origins', () => {
    it('parses a comma-separated list', () => {
      expect(
        buildCorsOptions('http://localhost:5174,http://localhost:5175').origin,
      ).toEqual(['http://localhost:5174', 'http://localhost:5175']);
    });

    it('trims whitespace around entries', () => {
      expect(
        buildCorsOptions(' http://a.test , http://b.test ').origin,
      ).toEqual(['http://a.test', 'http://b.test']);
    });

    it.each([
      ['undefined', undefined],
      ['an empty string', ''],
      ['only separators', ',,  ,'],
    ])('allows any origin when the value is %s', (_label, value) => {
      expect(buildCorsOptions(value).origin).toBe(true);
    });
  });

  // The two settings below fail silently in the browser when missing, which is
  // exactly why they are pinned here.
  describe('the admin dashboard depends on these', () => {
    it('allows PATCH, or the status control dies at the preflight', () => {
      expect(buildCorsOptions('http://localhost:5175').methods).toContain(
        'PATCH',
      );
    });

    it('allows DELETE, or deleting an order dies at the preflight', () => {
      expect(buildCorsOptions('http://localhost:5175').methods).toContain(
        'DELETE',
      );
    });

    it('exposes Content-Disposition, or STL downloads lose their filename', () => {
      expect(
        buildCorsOptions('http://localhost:5175').exposedHeaders,
      ).toContain('Content-Disposition');
    });

    it('allows the x-api-key request header', () => {
      expect(
        buildCorsOptions('http://localhost:5175').allowedHeaders,
      ).toContain('x-api-key');
    });
  });

  it('still allows the customer app methods', () => {
    const { methods } = buildCorsOptions(undefined);

    expect(methods).toEqual(expect.arrayContaining(['GET', 'POST', 'OPTIONS']));
  });
});
