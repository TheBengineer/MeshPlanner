import { describe, it, expect } from 'vitest'
import { LoraParamsForm } from '@/components/sidebar/LoraParamsForm'

describe('LoraParamsForm', () => {
  it('is exported as a function component', () => {
    expect(LoraParamsForm).toBeDefined()
    expect(typeof LoraParamsForm).toBe('function')
  })
})
