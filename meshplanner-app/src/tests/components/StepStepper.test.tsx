import { describe, it, expect, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { StepStepper } from '@/components/layout/StepStepper'

describe('StepStepper', () => {
  it('is exported as a function component', () => {
    expect(StepStepper).toBeDefined()
    expect(typeof StepStepper).toBe('function')
  })

  it('renders 4 steps without crashing', () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    act(() => {
      root.render(<StepStepper currentStep={0} onStepClick={() => {}} />)
    })
    expect(container.querySelector('[data-testid="step-stepper"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="step-0"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="step-1"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="step-2"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="step-3"]')).not.toBeNull()
    act(() => {
      root.unmount()
    })
  })

  it('calls onStepClick with the correct index when a step is clicked', () => {
    const onStepClick = vi.fn()
    const container = document.createElement('div')
    const root = createRoot(container)

    act(() => {
      root.render(<StepStepper currentStep={0} onStepClick={onStepClick} />)
    })

    const step1 = container.querySelector('[data-testid="step-1"]') as HTMLElement
    expect(step1).not.toBeNull()

    act(() => {
      step1.click()
    })

    expect(onStepClick).toHaveBeenCalledTimes(1)
    expect(onStepClick).toHaveBeenCalledWith(1)
    act(() => {
      root.unmount()
    })
  })

  it('applies active styles to the current step', () => {
    const container = document.createElement('div')
    const root = createRoot(container)

    act(() => {
      root.render(<StepStepper currentStep={2} onStepClick={() => {}} />)
    })

    const step2 = container.querySelector('[data-testid="step-2"]') as HTMLElement
    expect(step2).not.toBeNull()
    expect(step2.getAttribute('aria-current')).toBe('step')

    act(() => {
      root.unmount()
    })
  })

  it('renders checkmarks on completed steps', () => {
    const container = document.createElement('div')
    const root = createRoot(container)

    act(() => {
      root.render(<StepStepper currentStep={2} onStepClick={() => {}} />)
    })

    // Steps 0 and 1 should show checkmarks (completed)
    const step0 = container.querySelector('[data-testid="step-0"]') as HTMLElement
    const step1 = container.querySelector('[data-testid="step-1"]') as HTMLElement
    expect(step0?.textContent).toContain('✓')
    expect(step1?.textContent).toContain('✓')

    // Step 2 (current) should show number, not checkmark
    const step2 = container.querySelector('[data-testid="step-2"]') as HTMLElement
    expect(step2?.textContent).toContain('3')

    act(() => {
      root.unmount()
    })
  })

  it('has keyboard-accessible attributes on each step', () => {
    const container = document.createElement('div')
    const root = createRoot(container)

    act(() => {
      root.render(<StepStepper currentStep={0} onStepClick={() => {}} />)
    })

    for (let i = 0; i < 4; i++) {
      const step = container.querySelector(`[data-testid="step-${i}"]`) as HTMLElement
      expect(step.getAttribute('role')).toBe('button')
      expect(step.getAttribute('tabindex')).toBe('0')
      expect(step.getAttribute('aria-label')).toBe(`Step ${i + 1}: ${['Area', 'Mark Sites', 'Import', 'Configure'][i]}${i === 0 ? ' (current)' : ''}`)
    }

    act(() => {
      root.unmount()
    })
  })
})
