export const MAX_STL_BYTES = 25 * 1024 * 1024;

/**
 * Content types seen on real STL uploads. `application/octet-stream` and an
 * empty type are the common cases (browsers rarely know the STL media type);
 * `text/plain` covers ASCII STLs. The authoritative gate is still the byte
 * sniff in {@link isStlBuffer} — this only rejects an obviously-wrong type
 * (e.g. `image/png`) cheaply before that runs.
 */
const ALLOWED_STL_MIMETYPES = new Set([
  '',
  'application/octet-stream',
  'application/sla',
  'application/vnd.ms-pki.stl',
  'model/stl',
  'model/x.stl-ascii',
  'model/x.stl-binary',
  'text/plain',
]);

export function isAllowedStlMimetype(mimetype: string | undefined): boolean {
  return mimetype == null || ALLOWED_STL_MIMETYPES.has(mimetype.toLowerCase());
}

const BINARY_HEADER_BYTES = 80;
const TRIANGLE_COUNT_BYTES = 4;
const BYTES_PER_TRIANGLE = 50;

/**
 * Binary STL layout: 80-byte header, uint32 triangle count, then fixed-size
 * triangle records. If the arithmetic lines up exactly, this is a real binary STL.
 */
function isBinaryStl(buffer: Buffer): boolean {
  const headerSize = BINARY_HEADER_BYTES + TRIANGLE_COUNT_BYTES;

  if (buffer.length < headerSize) {
    return false;
  }

  const triangles = buffer.readUInt32LE(BINARY_HEADER_BYTES);

  return buffer.length === headerSize + triangles * BYTES_PER_TRIANGLE;
}

/**
 * ASCII STL. Checked after binary because a binary STL's 80-byte header is
 * arbitrary and frequently starts with the literal "solid" too — sniffing on
 * that prefix alone would misclassify it.
 */
function isAsciiStl(buffer: Buffer): boolean {
  const head = buffer.subarray(0, 512).toString('utf8').trimStart();

  if (!head.toLowerCase().startsWith('solid')) {
    return false;
  }

  // A real ASCII STL has facet geometry, not just the opening token.
  const body = buffer.toString('utf8');

  return /\bfacet\s+normal\b/i.test(body) && /\bendsolid\b/i.test(body);
}

export function isStlBuffer(buffer: Buffer): boolean {
  return isBinaryStl(buffer) || isAsciiStl(buffer);
}

export function hasStlExtension(filename: string): boolean {
  return /\.stl$/i.test(filename.trim());
}
