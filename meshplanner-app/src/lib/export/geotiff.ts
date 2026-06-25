import { writeArrayBuffer } from 'geotiff'

export async function exportGeotiff(
  rssi: Float32Array,
  width: number,
  height: number,
  affine: { a: number; b: number; c: number; d: number; e: number; f: number },
  threshold?: number,
): Promise<ArrayBuffer> {
  let data = rssi
  if (threshold !== undefined) {
    data = new Float32Array(rssi.length)
    for (let i = 0; i < rssi.length; i++) {
      data[i] = rssi[i]! >= threshold ? rssi[i]! : -9999
    }
  }
  const geotiff = writeArrayBuffer(
    Array.from(data),
    {
      width,
      height,
      Compression: 8,
      BitsPerSample: [32],
      SampleFormat: [3],
      ModelTiepoint: [0, 0, 0, affine.c, affine.f, 0],
      ModelPixelScale: [affine.a, -affine.e, 0],
      GeographicTypeGeoKey: 4326,
      GTModelTypeGeoKey: 2,
      GTRasterTypeGeoKey: 1,
      GeogCitationGeoKey: 'WGS 84',
      GDAL_NODATA: '-9999',
    },
  )
  return geotiff
}
