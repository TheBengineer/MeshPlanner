import { describe, it, expect, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { TabBar } from '@/components/layout/TabBar'

function render(ui: React.ReactElement) {
  const container = document.createElement('div')
  const root = createRoot(container)
  act(() => { root.render(ui) })
  return { container, root }
}

describe('TabBar', () => {
  it('is exported as a function component', () => {
    expect(TabBar).toBeDefined()
    expect(typeof TabBar).toBe('function')
  })

  it('renders three tabs with correct labels', () => {
    const { container } = render(<TabBar activeTab="setup" onTabChange={vi.fn()} />)

    const buttons = container.querySelectorAll<HTMLButtonElement>('button[role="tab"]')
    expect(buttons.length).toBe(3)
    expect(buttons[0]!.textContent).toBe('Setup')
    expect(buttons[1]!.textContent).toBe('Plan')
    expect(buttons[2]!.textContent).toBe('Results & Export')
  })

  it('marks the active tab with aria-selected="true"', () => {
    const { container } = render(<TabBar activeTab="plan" onTabChange={vi.fn()} />)

    const buttons = container.querySelectorAll<HTMLButtonElement>('button[role="tab"]')
    expect(buttons[0]!.getAttribute('aria-selected')).toBe('false')
    expect(buttons[1]!.getAttribute('aria-selected')).toBe('true')
    expect(buttons[2]!.getAttribute('aria-selected')).toBe('false')
  })

  it('calls onTabChange with the correct tab id when a tab is clicked', () => {
    const onTabChange = vi.fn()
    const { container } = render(<TabBar activeTab="setup" onTabChange={onTabChange} />)

    const buttons = container.querySelectorAll<HTMLButtonElement>('button[role="tab"]')
    act(() => { buttons[2]!.click() })

    expect(onTabChange).toHaveBeenCalledTimes(1)
    expect(onTabChange).toHaveBeenCalledWith('results')
  })

  it('assigns role="tablist" to the container', () => {
    const { container } = render(<TabBar activeTab="setup" onTabChange={vi.fn()} />)

    const tablist = container.querySelector<HTMLElement>('[role="tablist"]')
    expect(tablist).not.toBeNull()
  })
})
