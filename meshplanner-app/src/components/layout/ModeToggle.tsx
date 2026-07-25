import { type ReactNode, useEffect } from 'react'
import { useStore } from '@/store'

const STORAGE_KEY = 'meshplanner-guided-mode'

const containerStyle: React.CSSProperties = {
  display: 'flex',
  borderRadius: 6,
  overflow: 'hidden',
  border: '1px solid var(--border)',
}

const btnBase: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: 12,
  fontWeight: 600,
  border: 'none',
  cursor: 'pointer',
  transition: 'background 0.15s, color 0.15s',
  outline: 'none',
}

export function ModeToggle(): ReactNode {
  const guidedMode = useStore((s) => s.guidedMode)
  const setGuidedMode = useStore((s) => s.setGuidedMode)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(guidedMode))
  }, [guidedMode])

  const activeStyle: React.CSSProperties = {
    ...btnBase,
    background: 'var(--accent)',
    color: '#fff',
  }

  const inactiveStyle: React.CSSProperties = {
    ...btnBase,
    background: 'var(--bg-secondary)',
    color: 'var(--text)',
  }

  return (
    <div
      role="radiogroup"
      aria-label="Mode toggle"
      data-testid="mode-toggle"
      style={containerStyle}
    >
      <button
        type="button"
        role="radio"
        aria-checked={guidedMode}
        data-testid="mode-guided"
        onClick={() => setGuidedMode(true)}
        style={guidedMode ? activeStyle : inactiveStyle}
      >
        Guided
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={!guidedMode}
        data-testid="mode-expert"
        onClick={() => setGuidedMode(false)}
        style={!guidedMode ? activeStyle : inactiveStyle}
      >
        Expert
      </button>
    </div>
  )
}
