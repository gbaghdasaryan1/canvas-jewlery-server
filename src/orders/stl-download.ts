/**
 * The naming pattern for an order's STL: the S3 object key is `<stem>.stl` and
 * the download is named the same, where the stem is `[phone]-[barcode]`, e.g.
 * `+37455123456-0042317.stl`. Both inputs are server-controlled (E.164 phone,
 * generated 7-digit barcode) and contain no path separators or header-hostile
 * characters, so the result is safe as an object key and inside a
 * Content-Disposition header.
 */
export function stlFileStem(phone: string, barcode: string): string {
  return `${phone}-${barcode}`;
}

export function stlDownloadFilename(phone: string, barcode: string): string {
  return `${stlFileStem(phone, barcode)}.stl`;
}

/**
 * RFC 5987/6266 header value. The bare `filename` carries an ASCII-only
 * approximation for old clients; `filename*` carries the real UTF-8 name, and
 * every modern browser prefers it. `disposition` is `attachment` for a forced
 * download and `inline` for a preview the browser/viewer may render in place.
 */
export function buildContentDisposition(
  filename: string,
  disposition: 'attachment' | 'inline' = 'attachment',
): string {
  const asciiFallback =
    filename.replace(/[^\x20-\x7e]/g, '_').replace(/^_+$/, '') ||
    'download.stl';

  return [
    disposition,
    `filename="${asciiFallback}"`,
    `filename*=UTF-8''${encodeRFC5987(filename)}`,
  ].join('; ');
}

/** encodeURIComponent leaves a few characters that are not valid attr-chars. */
function encodeRFC5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
