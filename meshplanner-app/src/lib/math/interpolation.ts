const NODATA_THRESHOLD = -30000
export function bilinearInterpolate(data: Float32Array | Float64Array | number[], width: number, height: number, col: number, row: number): number | null {
  if (col < 0 || col > width - 1 || row < 0 || row > height - 1) return null
  const col0 = Math.floor(col), row0 = Math.floor(row)
  const col1 = Math.min(col0 + 1, width - 1), row1 = Math.min(row0 + 1, height - 1)
  const fx = col - col0, fy = row - row0
  const v00 = data[row0 * width + col0]
  const v10 = data[row0 * width + col1]
  const v01 = data[row1 * width + col0]
  const v11 = data[row1 * width + col1]
  if (v00 === undefined || v10 === undefined || v01 === undefined || v11 === undefined) return null
  if (v00 < NODATA_THRESHOLD || v10 < NODATA_THRESHOLD || v01 < NODATA_THRESHOLD || v11 < NODATA_THRESHOLD) return null
  const top = v00 + (v10 - v00) * fx
  const bottom = v01 + (v11 - v01) * fx
  return top + (bottom - top) * fy
}
export function angularInterpolate(leftRssi: number, rightRssi: number, leftAngle: number, rightAngle: number, targetAngle: number): number {
  let diff = rightAngle - leftAngle; if (diff < 0) diff += 360
  let offset = targetAngle - leftAngle; if (offset < 0) offset += 360
  if (diff === 0) return leftRssi
  const fraction = offset / diff
  return leftRssi + (rightRssi - leftRssi) * Math.min(1, Math.max(0, fraction))
}
