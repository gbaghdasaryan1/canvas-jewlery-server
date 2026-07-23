import { hasStlExtension, isStlBuffer } from './stl.validation';

function binaryStl(triangleCount: number): Buffer {
  const buffer = Buffer.alloc(84 + triangleCount * 50);
  buffer.write('solid exported-from-cad', 0); // header often starts with "solid"
  buffer.writeUInt32LE(triangleCount, 80);
  return buffer;
}

const ASCII_STL = `solid model
facet normal 0 0 1
  outer loop
    vertex 0 0 0
    vertex 1 0 0
    vertex 0 1 0
  endloop
endfacet
endsolid model
`;

describe('stl validation', () => {
  describe('isStlBuffer', () => {
    it('accepts a well-formed binary STL', () => {
      expect(isStlBuffer(binaryStl(12))).toBe(true);
    });

    it('accepts a binary STL with zero triangles', () => {
      expect(isStlBuffer(binaryStl(0))).toBe(true);
    });

    it('accepts an ASCII STL', () => {
      expect(isStlBuffer(Buffer.from(ASCII_STL))).toBe(true);
    });

    it('rejects a binary STL whose triangle count does not match its length', () => {
      const truncated = binaryStl(12).subarray(0, 200);
      expect(isStlBuffer(truncated)).toBe(false);
    });

    it('rejects a PNG', () => {
      const png = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.alloc(500),
      ]);
      expect(isStlBuffer(png)).toBe(false);
    });

    it('rejects text that merely starts with "solid"', () => {
      expect(isStlBuffer(Buffer.from('solid gold, not a mesh'))).toBe(false);
    });

    it('rejects an empty buffer', () => {
      expect(isStlBuffer(Buffer.alloc(0))).toBe(false);
    });
  });

  describe('hasStlExtension', () => {
    it.each(['model.stl', 'MODEL.STL', 'a.b.stl', ' model.stl '])(
      'accepts %s',
      (name) => {
        expect(hasStlExtension(name)).toBe(true);
      },
    );

    it.each(['model.png', 'model.stl.exe', 'stl', 'model.stlx'])(
      'rejects %s',
      (name) => {
        expect(hasStlExtension(name)).toBe(false);
      },
    );
  });
});
