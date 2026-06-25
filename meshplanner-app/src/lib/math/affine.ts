export class Affine {
  a: number; b: number; c: number; d: number; e: number; f: number

  constructor(a: number, b: number, c: number, d: number, e: number, f: number) {
    this.a = a; this.b = b; this.c = c; this.d = d; this.e = e; this.f = f
  }

  transform(col: number, row: number): [number, number] {
    return [this.a * col + this.b * row + this.c, this.d * col + this.e * row + this.f]
  }

  pixelToGeo(col: number, row: number): [number, number] {
    return this.transform(col, row)
  }

  geoToPixel(lon: number, lat: number): [number, number] {
    const det = this.a * this.e - this.b * this.d
    if (Math.abs(det) < 1e-15) return [NaN, NaN]
    return [(this.e * (lon - this.c) - this.b * (lat - this.f)) / det, (this.a * (lat - this.f) - this.d * (lon - this.c)) / det]
  }

  invert(): Affine {
    const det = this.a * this.e - this.b * this.d
    if (Math.abs(det) < 1e-15) throw new Error("Singular affine transform")
    return new Affine(
      this.e / det, -this.b / det, (this.b * this.f - this.e * this.c) / det,
      -this.d / det, this.a / det, (this.d * this.c - this.a * this.f) / det,
    )
  }

  resolution(): number {
    return Math.sqrt(Math.abs(this.a * this.e))
  }

  pixelWidthDeg(): number { return Math.abs(this.a) }
  pixelHeightDeg(): number { return Math.abs(this.e) }

  compose(other: Affine): Affine {
    return new Affine(
      this.a * other.a + this.b * other.d, this.a * other.b + this.b * other.e,
      this.a * other.c + this.b * other.f + this.c,
      this.d * other.a + this.e * other.d, this.d * other.b + this.e * other.e,
      this.d * other.c + this.e * other.f + this.f,
    )
  }

  static fromBounds(west: number, south: number, east: number, north: number, width: number, height: number): Affine {
    return new Affine((east - west) / width, 0, west, 0, (south - north) / height, north)
  }
}
