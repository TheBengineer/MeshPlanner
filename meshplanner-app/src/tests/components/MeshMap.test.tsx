import { describe, it, expect } from 'vitest'
import { MeshMap } from '@/components/map/MeshMap'

describe('MeshMap', () => {
  it('is exported as a function component', () => {
    expect(MeshMap).toBeDefined()
    expect(typeof MeshMap).toBe('function')
  })
})
