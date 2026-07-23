import {
  buildContentDisposition,
  stlDownloadFilename,
  stlFileStem,
} from './stl-download';

const PHONE = '+37455123456';
const BARCODE = '0042317';

describe('stl file naming', () => {
  it('builds the stem as [phone]-[barcode]', () => {
    expect(stlFileStem(PHONE, BARCODE)).toBe('+37455123456-0042317');
  });

  it('builds the download filename as [phone]-[barcode].stl', () => {
    expect(stlDownloadFilename(PHONE, BARCODE)).toBe(
      '+37455123456-0042317.stl',
    );
  });

  it('keeps zero-padded barcodes intact', () => {
    expect(stlDownloadFilename('+37400000001', '0000007')).toBe(
      '+37400000001-0000007.stl',
    );
  });
});

describe('buildContentDisposition', () => {
  it('emits both an ASCII fallback and a UTF-8 parameter', () => {
    expect(buildContentDisposition('ring.stl')).toBe(
      `attachment; filename="ring.stl"; filename*=UTF-8''ring.stl`,
    );
  });

  it('carries a [phone]-[barcode] name, "+" and all', () => {
    expect(buildContentDisposition(stlDownloadFilename(PHONE, BARCODE))).toBe(
      `attachment; filename="+37455123456-0042317.stl"; filename*=UTF-8''%2B37455123456-0042317.stl`,
    );
  });

  it('never emits an empty ASCII fallback', () => {
    expect(buildContentDisposition('Արարատ')).toContain(
      'filename="download.stl"',
    );
  });
});
