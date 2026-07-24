/* Type stub for the Emscripten-generated SPLAT! WASM module. */

export interface SplatModule {
  HEAP8: Int8Array
  HEAPU8: Uint8Array
  HEAP16: Int16Array
  HEAPU16: Uint16Array
  HEAP32: Int32Array
  HEAPU32: Uint32Array
  HEAPF32: Float32Array
  HEAPF64: Float64Array
  _splat_create(
    lat: number, lon: number,
    txAltFeet: number, rxAltFeet: number,
    frequencyMhz: number, erpWatts: number,
    groundDielectric: number, groundConductivity: number,
    atmosphereBending: number,
    radioClimate: number, polarization: number,
    conf: number, rel: number,
    clutterHeightM: number,
    radiusKm: number,
    resolutionIppd: number,
  ): number
  _splat_page_count(handle: number): number
  _splat_page_info(handle: number, index: number, out: number): number
  _splat_load_page(handle: number, index: number, ptr: number): number
  _splat_radial_count(handle: number): number
  _splat_run_radials(handle: number, start: number, count: number): number
  _splat_rasterize(handle: number): number
  _splat_region_info(handle: number, out: number): number
  _splat_signal_ptr(handle: number): number
  _splat_mask_ptr(handle: number): number
  _splat_errnum_counts(handle: number, out: number): number
  _splat_destroy(handle: number): void
  _splat_malloc(size: number): number
  _splat_free(ptr: number): void
}

declare function createSplatModule(mod?: {
  locateFile?: (path: string) => string
}): Promise<SplatModule>

export default createSplatModule
