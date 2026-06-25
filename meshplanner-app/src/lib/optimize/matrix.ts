import type { CoverageRaster, CoverageMatrix } from "../types"

export function buildCoverageMatrix(rasters: Map<string, CoverageRaster>, threshold: number, cellSizePx: number = 4): CoverageMatrix {
  const names = [...rasters.keys()]
  const firstName = names[0]
  if (!firstName) throw new Error("No rasters provided")
  const first = rasters.get(firstName)!
  const h = first.height
  const w = first.width
  const hOut = Math.ceil(h / cellSizePx)
  const wOut = Math.ceil(w / cellSizePx)
  const nCells = hOut * wOut
  const nSites = names.length

  const rows: number[] = []
  const cols: number[] = []
  for (let si = 0; si < nSites; si++) {
    const name = names[si]
    if (!name) continue
    const r = rasters.get(name)
    if (!r) continue
    const rssi = r.rssi
    const seen = new Set<number>()
    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        if ((rssi[row * w + col] ?? -Infinity) >= threshold) {
          const outRow = Math.floor(row / cellSizePx)
          const outCol = Math.floor(col / cellSizePx)
          const cellIdx = outRow * wOut + outCol
          if (!seen.has(cellIdx)) { seen.add(cellIdx); cols.push(cellIdx) }
        }
      }
    }
    for (let k = 0; k < seen.size; k++) rows.push(si)
  }

  const rowPtr = new Uint32Array(nSites + 1)
  for (let i = 0; i < rows.length; i++) {
    const rowVal = rows[i]!
    rowPtr[rowVal + 1] = rowPtr[rowVal + 1]! + 1
  }
  for (let i = 1; i <= nSites; i++) rowPtr[i] = rowPtr[i]! + rowPtr[i - 1]!

  const colArray = Uint32Array.from(cols)
  return { rowPtr, colIndices: colArray, nSites, nCells }
}
