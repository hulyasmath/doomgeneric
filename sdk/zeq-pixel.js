/* Engine-neutral zeq-pixel-v1 reference arithmetic. No Doom or DOM dependency. */
(function (root) {
  "use strict";
  const LIMIT = 1000000000n;
  const SUBPIXEL = 256n;
  const MAX_DIMENSION = 4096;
  const MAX_PIXELS = 16777216;
  const WRITE = Object.freeze({ INVALID: 0, WRITTEN: 1, OCCLUDED: 2, IDENTICAL: 3 });
  const PROJECT = Object.freeze({ INVALID: 0, INSIDE: 1, OUTSIDE: 2 });
  const empty = () => ({ depth: 0xffffffff, owner: 0, layer: 0x7fffffff, claims: 0, rgba: 0 });

  function rat(num, den = 1) { return { num: BigInt(num), den: BigInt(den) }; }
  function validRat(value) {
    return value && typeof value.num === "bigint" && typeof value.den === "bigint" &&
      value.den > 0n && value.den <= LIMIT && value.num >= -LIMIT && value.num <= LIMIT;
  }
  function init(width, height, storage) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
        width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS) {
      throw new RangeError("invalid zeq-pixel dimensions");
    }
    const count = width * height;
    if (storage && (!Array.isArray(storage) || storage.length < count)) throw new RangeError("short pixel storage");
    const pixels = storage || Array.from({ length: count }, empty);
    const surface = { format: "zeq-pixel-v1", width, height, pixels };
    clear(surface);
    return surface;
  }
  function validSurface(surface) {
    return surface && surface.format === "zeq-pixel-v1" && Number.isInteger(surface.width) &&
      Number.isInteger(surface.height) && surface.width > 0 && surface.height > 0 &&
      surface.width <= MAX_DIMENSION && surface.height <= MAX_DIMENSION &&
      surface.width * surface.height <= MAX_PIXELS && Array.isArray(surface.pixels) &&
      surface.pixels.length >= surface.width * surface.height;
  }
  function clear(surface) {
    if (!validSurface(surface)) throw new TypeError("invalid zeq-pixel surface");
    for (let i = 0; i < surface.width * surface.height; i++) surface.pixels[i] = empty();
  }
  function write(surface, x, y, depth, owner, layer, claims, rgba) {
    if (!validSurface(surface) || !Number.isInteger(x) || !Number.isInteger(y) ||
        x < 0 || y < 0 || x >= surface.width || y >= surface.height ||
        !Number.isInteger(depth) || depth < 0 || depth > 0xffffffff ||
        !Number.isInteger(owner) || owner < 1 || owner > 0xffffffff ||
        !Number.isInteger(layer) || layer < -0x80000000 || layer > 0x7fffffff ||
        !Number.isInteger(claims) || claims < 1 || claims > 0xffffffff ||
        !Number.isInteger(rgba) || rgba < 0 || rgba > 0xffffffff || (rgba & 0xff) !== 0xff) return WRITE.INVALID;
    const pixel = surface.pixels[y * surface.width + x];
    if (pixel.claims) {
      const existingWins = pixel.depth < depth || (pixel.depth === depth && pixel.layer < layer) ||
        (pixel.depth === depth && pixel.layer === layer && pixel.owner < owner);
      if (existingWins) return WRITE.OCCLUDED;
      if (pixel.depth === depth && pixel.layer === layer && pixel.owner === owner) {
        if (pixel.rgba !== rgba) return WRITE.INVALID;
        pixel.claims = (pixel.claims | claims) >>> 0;
        return WRITE.IDENTICAL;
      }
    }
    pixel.depth = depth >>> 0;
    pixel.owner = owner >>> 0;
    pixel.layer = layer | 0;
    pixel.claims = claims >>> 0;
    pixel.rgba = rgba >>> 0;
    return WRITE.WRITTEN;
  }
  function gcd(a, b) {
    if (a < 0n) a = -a;
    while (a) { const remainder = b % a; b = a; a = remainder; }
    return b;
  }
  function reduce(num, den) {
    if (den <= 0n) return null;
    const divisor = gcd(num, den);
    num /= divisor; den /= divisor;
    if (num < -(2n ** 63n - 1n) || num > 2n ** 63n - 1n || den > 2n ** 63n - 1n) return null;
    return { num, den };
  }
  function project(x, y, z, focal, width, height) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
        width > MAX_DIMENSION || height > MAX_DIMENSION || !validRat(x) || !validRat(y) ||
        !validRat(z) || !validRat(focal) || z.num <= 0n || focal.num <= 0n) {
      return { status: PROJECT.INVALID };
    }
    const den = focal.den * x.den * z.num;
    const yDen = focal.den * y.den * z.num;
    let xn = SUBPIXEL * focal.num * x.num * z.den;
    let yn = SUBPIXEL * focal.num * y.num * z.den;
    xn += BigInt(width) * (SUBPIXEL / 2n) * den;
    yn = BigInt(height) * (SUBPIXEL / 2n) * yDen - yn;
    const px = reduce(xn, den), py = reduce(yn, yDen);
    if (!px || !py) return { status: PROJECT.INVALID };
    const point = { x: px, y: py };
    if (px.num < 0n || py.num < 0n || px.num >= BigInt(width) * SUBPIXEL * px.den ||
        py.num >= BigInt(height) * SUBPIXEL * py.den) return { status: PROJECT.OUTSIDE, point };
    return { status: PROJECT.INSIDE, point };
  }
  function floor(value) { let q = value.num / value.den; if (value.num % value.den < 0n) q--; return q; }
  function ceil(value) { let q = value.num / value.den; if (value.num % value.den > 0n) q++; return q; }
  function line(surface, vertical, fixed, start, end, depth, owner, layer, claims, rgba) {
    if (!validSurface(surface) || !validRat(start) || !validRat(end)) return -1;
    const limit = vertical ? surface.height : surface.width;
    if (!Number.isInteger(fixed) || fixed < 0 || fixed >= (vertical ? surface.width : surface.height)) return 0;
    if (start.num * end.den > end.num * start.den) return -1;
    let first = floor(start), last = ceil(end);
    if (first < 0n) first = 0n;
    if (last > BigInt(limit)) last = BigInt(limit);
    if (last <= first) return 0;
    let accepted = 0;
    for (let i = first; i < last; i++) {
      const result = vertical ? write(surface, fixed, Number(i), depth, owner, layer, claims, rgba)
        : write(surface, Number(i), fixed, depth, owner, layer, claims, rgba);
      if (result === WRITE.INVALID) return -1;
      if (result === WRITE.WRITTEN || result === WRITE.IDENTICAL) accepted++;
    }
    return accepted;
  }
  function span(surface, y, start, end, depth, owner, layer, claims, rgba) {
    return line(surface, false, y, start, end, depth, owner, layer, claims, rgba);
  }
  function column(surface, x, start, end, depth, owner, layer, claims, rgba) {
    return line(surface, true, x, start, end, depth, owner, layer, claims, rgba);
  }
  function put32(bytes, offset, value) {
    bytes[offset] = value & 255; bytes[offset + 1] = (value >>> 8) & 255;
    bytes[offset + 2] = (value >>> 16) & 255; bytes[offset + 3] = (value >>> 24) & 255;
  }
  function serialize(surface, occupancy) {
    if (!validSurface(surface)) throw new TypeError("invalid zeq-pixel surface");
    const stride = occupancy ? 16 : 4;
    const bytes = new Uint8Array(16 + surface.width * surface.height * stride);
    bytes.set(new TextEncoder().encode(occupancy ? "ZEQOCC1\0" : "ZEQFRM1\0"), 0);
    put32(bytes, 8, surface.width); put32(bytes, 12, surface.height);
    let offset = 16;
    for (let i = 0; i < surface.width * surface.height; i++) {
      const p = surface.pixels[i];
      if (occupancy) {
        put32(bytes, offset, p.depth); put32(bytes, offset + 4, p.owner);
        put32(bytes, offset + 8, p.layer); put32(bytes, offset + 12, p.claims);
      } else put32(bytes, offset, p.rgba);
      offset += stride;
    }
    return bytes;
  }
  root.ZeqPixel = Object.freeze({ FORMAT: "zeq-pixel-v1", SUBPIXEL: 256, WRITE, PROJECT,
    rat, init, clear, write, project, span, column,
    frameBytes: surface => serialize(surface, false), occupancyBytes: surface => serialize(surface, true) });
})(typeof window !== "undefined" ? window : globalThis);
