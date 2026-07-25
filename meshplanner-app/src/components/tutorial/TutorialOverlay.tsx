import { type ReactNode, useEffect, useCallback } from 'react'

/* ── Step definitions ── */

interface Step {
  title: string
  description: string
  details: string[]
}

const STEPS: Step[] = [
  {
    title: '1. Select Area',
    description: 'Define the disaster zone on the map.',
    details: [
      'Draw a bounding box around the affected region (e.g., a flood-impacted valley).',
      'The map will fetch SRTM 30m elevation data for this area.',
      'Use the terrain overlay to understand topography and line-of-sight constraints.',
    ],
  },
  {
    title: '2. Mark Sites & Coordination Areas',
    description: 'Place markers for existing LoRa nodes and required coverage zones.',
    details: [
      'Click "Place Sites" then click the map to add a node location (fire station, shelter, EOC).',
      'Use "Add Coordination Area" to mark locations that need coverage but have no node yet.',
      'Drag markers to fine-tune positions. Upload sites via CSV/GeoJSON or import from OSM.',
    ],
  },
  {
    title: '3. Import Infrastructure',
    description: 'Pull in critical infrastructure data automatically.',
    details: [
      'Use the OSM import to fetch fire stations, schools, hospitals, and towers via Overpass API.',
      'Upload CSV/GeoJSON files with pre-existing site surveys.',
      'Generate regular grid points at configurable spacing for systematic coverage planning.',
    ],
  },
  {
    title: '4. Configure Parameters',
    description: 'Set radio link parameters and coverage targets.',
    details: [
      'Configure LoRa parameters: frequency band (US915/EU868/AU915/AS923), SF, power, antenna gain.',
      'Set coverage threshold and target coverage percentage.',
      'Use device profile quick-fill for common Meshtastic hardware configurations.',
      'Adjust link budget parameters for the local terrain and environment.',
    ],
  },
  {
    title: '5. Plan Mesh',
    description: 'Run the automated mesh planning engine.',
    details: [
      'The terrain scout detects topographic prominences and ranks peaks by viewshed coverage.',
      'A connectivity-aware greedy algorithm selects sites that link to the existing mesh.',
      'Kruskal\'s algorithm builds a minimum spanning tree, auto-inserting relay sites for gaps.',
      'An ILP solver (hiGHS WASM) upgrades the greedy result to optimal in the background.',
    ],
  },
  {
    title: '6. Review Results',
    description: 'Examine coverage maps, link budgets, and optimization results.',
    details: [
      'View RSSI heatmap overlay with adjustable threshold.',
      'Inspect MST edges colored by link margin (green/yellow/red).',
      'Review coverage gap analysis for areas within the target zone not yet covered.',
      'Run sensitivity analysis across nominal/optimistic/pessimistic scenarios.',
    ],
  },
  {
    title: '7. Export',
    description: 'Download your deployment plan for field use.',
    details: [
      'Export selected sites, coverage polygon, and MST edges as GeoJSON.',
      'Download per-site metrics as CSV.',
      'Generate KML for use in Google Earth or field GPS devices.',
      'Export GeoTIFF coverage raster with threshold masking.',
    ],
  },
]

/* ── Styles ── */

const backdropStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 9999,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(0, 0, 0, 0.55)',
  backdropFilter: 'blur(2px)',
}

const panelStyle: React.CSSProperties = {
  position: 'relative',
  width: 'min(90vw, 580px)',
  maxHeight: '85vh',
  overflowY: 'auto',
  background: 'var(--bg)',
  borderRadius: 12,
  boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
  padding: '32px 28px 28px',
}

const closeBtnStyle: React.CSSProperties = {
  position: 'absolute',
  top: 12,
  right: 12,
  width: 32,
  height: 32,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  borderRadius: 6,
  background: 'var(--bg-secondary)',
  color: 'var(--text)',
  fontSize: 18,
  fontWeight: 600,
  cursor: 'pointer',
  lineHeight: 1,
}

const headingStyle: React.CSSProperties = {
  margin: '0 0 4px',
  fontSize: 20,
  fontWeight: 700,
  color: 'var(--text-h)',
}

const subheadingStyle: React.CSSProperties = {
  margin: '0 0 24px',
  fontSize: 13,
  color: 'var(--text-secondary)',
  lineHeight: 1.5,
}

const stepCardStyle: React.CSSProperties = {
  padding: '14px 16px',
  marginBottom: 10,
  borderRadius: 8,
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border)',
}

const stepTitleStyle: React.CSSProperties = {
  margin: '0 0 2px',
  fontSize: 14,
  fontWeight: 600,
  color: 'var(--text-h)',
}

const stepDescStyle: React.CSSProperties = {
  margin: '0 0 6px',
  fontSize: 12,
  color: 'var(--text)',
  lineHeight: 1.5,
}

const detailListStyle: React.CSSProperties = {
  margin: 0,
  paddingLeft: 16,
  fontSize: 12,
  color: 'var(--text-secondary)',
  lineHeight: 1.6,
}

/* ── Component ── */

interface TutorialOverlayProps {
  onClose: () => void
}

export function TutorialOverlay({ onClose }: TutorialOverlayProps): ReactNode {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    },
    [onClose],
  )

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose()
    },
    [onClose],
  )

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Workflow tutorial"
      style={backdropStyle}
      onClick={handleBackdropClick}
    >
      <div style={panelStyle}>
        <button
          type="button"
          onClick={onClose}
          style={closeBtnStyle}
          aria-label="Close tutorial"
        >
          ✕
        </button>

        <h2 style={headingStyle}>MeshPlanner Workflow</h2>
        <p style={subheadingStyle}>
          Seven steps to plan a resilient LoRa mesh network for disaster recovery.
          All computation runs locally in your browser — no server required.
        </p>

        {STEPS.map((step) => (
          <div key={step.title} style={stepCardStyle}>
            <h3 style={stepTitleStyle}>{step.title}</h3>
            <p style={stepDescStyle}>{step.description}</p>
            <ul style={detailListStyle}>
              {step.details.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}
