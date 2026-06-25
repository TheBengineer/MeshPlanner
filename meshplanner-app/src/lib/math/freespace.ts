export function fspl(freqMhz: number, distKm: number): number {
  if (!Number.isFinite(freqMhz) || !Number.isFinite(distKm)) return NaN
  if (freqMhz <= 0) return NaN
  if (distKm <= 0) return Infinity
  return 32.45 + 20 * Math.log10(freqMhz) + 20 * Math.log10(distKm)
}
