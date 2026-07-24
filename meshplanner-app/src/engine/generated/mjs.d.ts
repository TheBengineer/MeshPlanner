declare module '*.mjs' {
  const create: (opts?: { locateFile?: (path: string) => string }) => Promise<{
    HEAP8: Int8Array; HEAPU8: Uint8Array; HEAP16: Int16Array; HEAPU16: Uint16Array
    HEAP32: Int32Array; HEAPU32: Uint32Array; HEAPF32: Float32Array; HEAPF64: Float64Array
    _splat_create: (...args: number[]) => number
    _splat_page_count: (h: number) => number
    _splat_page_info: (h: number, i: number, o: number) => number
    _splat_load_page: (h: number, i: number, p: number) => number
    _splat_radial_count: (h: number) => number
    _splat_run_radials: (h: number, s: number, c: number) => number
    _splat_rasterize: (h: number) => number
    _splat_region_info: (h: number, o: number) => number
    _splat_signal_ptr: (h: number) => number
    _splat_mask_ptr: (h: number) => number
    _splat_errnum_counts: (h: number, o: number) => number
    _splat_destroy: (h: number) => void
    _splat_malloc: (s: number) => number
    _splat_free: (p: number) => void
  }>
  export default create
}
