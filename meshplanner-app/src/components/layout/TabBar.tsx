import { type ReactNode } from 'react'

export type TabId = 'setup' | 'plan' | 'results'

interface TabBarProps {
  activeTab: TabId
  onTabChange: (tab: TabId) => void
}

const TABS: { id: TabId; label: string }[] = [
  { id: 'setup', label: 'Setup' },
  { id: 'plan', label: 'Plan' },
  { id: 'results', label: 'Results & Export' },
]

const tabBase: React.CSSProperties = {
  flex: 1,
  padding: '8px 8px',
  fontSize: 12,
  fontWeight: 500,
  border: 'none',
  borderRadius: 0,
  cursor: 'pointer',
  transition: 'background 0.15s, color 0.15s',
  outline: 'none',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

const activeTabStyle: React.CSSProperties = {
  ...tabBase,
  background: 'var(--accent)',
  color: '#fff',
  fontWeight: 600,
}

const inactiveTabStyle: React.CSSProperties = {
  ...tabBase,
  background: 'var(--bg-secondary)',
  color: 'var(--text)',
}

const containerStyle: React.CSSProperties = {
  display: 'flex',
  borderRadius: 4,
  overflow: 'hidden',
  border: '1px solid var(--border)',
  minHeight: 36,
}

export function TabBar({ activeTab, onTabChange }: TabBarProps): ReactNode {
  return (
    <div
      role="tablist"
      aria-label="Mesh planner workflow"
      data-testid="tab-bar"
      style={containerStyle}
    >
      {TABS.map((tab) => {
        const isActive = tab.id === activeTab
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={`tabpanel-${tab.id}`}
            data-testid={`tab-${tab.id}`}
            onClick={() => onTabChange(tab.id)}
            style={isActive ? activeTabStyle : inactiveTabStyle}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
