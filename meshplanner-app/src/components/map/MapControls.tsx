interface MapControlsProps {
  onResetView: () => void
  bboxInfo?: string
}

export function MapControls({ onResetView, bboxInfo }: MapControlsProps) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 8,
        right: 8,
        zIndex: 1,
        background: 'white',
        padding: 8,
        borderRadius: 4,
        boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
      }}
    >
      <button onClick={onResetView} aria-label="Reset map view to default extent" type="button">Reset View</button>
      {bboxInfo && (
        <div style={{ fontSize: 11, marginTop: 4 }}>{bboxInfo}</div>
      )}
    </div>
  )
}
