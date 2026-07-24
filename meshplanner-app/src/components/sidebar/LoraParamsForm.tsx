import { useState, useCallback, useRef, useEffect } from 'react'
import { calculateLinkBudget, SF_SENSITIVITY, BAND_CENTERS } from '@/lib/math/link-budget'
import type { LoraParams } from '@/lib/types'
import { useStore } from '@/store'

const CLIMATE_CODES: Record<number, string> = {
  1: 'Equatorial',
  2: 'Continental Subtropical',
  3: 'Maritime Subtropical',
  4: 'Desert',
  5: 'Continental Temperate',
  6: 'Maritime Temperate (land)',
  7: 'Maritime Temperate (sea)',
}

interface DeviceProfile {
  label: string
  txPowerDbm: number
  txGainDbi: number
}

const DEVICE_PROFILES: DeviceProfile[] = [
  { label: 'Custom / manual', txPowerDbm: 22, txGainDbi: 3 },
  { label: 'Heltec WiFi LoRa 32 V3', txPowerDbm: 21, txGainDbi: 2 },
  { label: 'Heltec WiFi LoRa 32 V4 (high-power)', txPowerDbm: 28, txGainDbi: 2 },
  { label: 'Heltec WiFi LoRa 32 V2', txPowerDbm: 20, txGainDbi: 3 },
  { label: 'LILYGO T-Beam (SX1262)', txPowerDbm: 22, txGainDbi: 2 },
  { label: 'LILYGO T-Beam Supreme', txPowerDbm: 22, txGainDbi: 2 },
  { label: 'LILYGO T-Echo', txPowerDbm: 22, txGainDbi: 1 },
  { label: 'LILYGO T-Deck', txPowerDbm: 22, txGainDbi: 2 },
  { label: 'RAK WisBlock (RAK4631)', txPowerDbm: 22, txGainDbi: 2 },
  { label: 'Station G2', txPowerDbm: 30, txGainDbi: 3 },
  { label: 'Seeed SenseCAP T1000-E', txPowerDbm: 22, txGainDbi: 1 },
]

/* Track which fields belong to each collapsible section for dirty indicators. */
type SectionId = 'lora' | 'tx' | 'rx' | 'sim' | 'optimization' | 'env'

interface FormSnapshot {
  band: string; sf: number
  txPower: number; txHeight: number; txGain: number; cableLossTx: number
  rxHeight: number; rxGain: number; rxSensitivity: number; cableLossRx: number
  maxRange: number; threshold: number; situationFraction: number; timeFraction: number; highRes: boolean
  mode: string; target: number
  climate: number; polarization: number; groundPermittivity: number
  groundConductivity: number; surfaceRefractivity: number; clutterHeight: number
}

const EMPTY_SNAPSHOT: FormSnapshot = {
  band: '', sf: 0,
  txPower: 0, txHeight: 0, txGain: 0, cableLossTx: 0,
  rxHeight: 0, rxGain: 0, rxSensitivity: 0, cableLossRx: 0,
  maxRange: 0, threshold: 0, situationFraction: 0, timeFraction: 0, highRes: false,
  mode: '', target: 0,
  climate: 0, polarization: 0, groundPermittivity: 0,
  groundConductivity: 0, surfaceRefractivity: 0, clutterHeight: 0,
}

/* Which snapshot keys belong to each section. */
const SECTION_FIELDS: Record<SectionId, (keyof FormSnapshot)[]> = {
  lora: ['band', 'sf'],
  tx: ['txPower', 'txHeight', 'txGain', 'cableLossTx'],
  rx: ['rxHeight', 'rxGain', 'rxSensitivity', 'cableLossRx'],
  sim: ['maxRange', 'threshold', 'situationFraction', 'timeFraction', 'highRes'],
  optimization: ['mode', 'target'],
  env: ['climate', 'polarization', 'groundPermittivity', 'groundConductivity', 'surfaceRefractivity', 'clutterHeight'],
}

interface LoraParamsFormProps {
  onParamsChange?: (params: LoraParams, coverageKwargs: Record<string, number | boolean>) => void
}

export function LoraParamsForm({ onParamsChange }: LoraParamsFormProps) {
  /* LoRa / PHY */
  const [band, setBand] = useState('US915')
  const [sf, setSf] = useState(10)

  /* Transmitter */
  const [txPower, setTxPower] = useState(22)
  const [txHeight, setTxHeight] = useState(2)
  const [txGain, setTxGain] = useState(3)
  const [cableLossTx, setCableLossTx] = useState(0.5)
  const [deviceIdx, setDeviceIdx] = useState(0)

  /* Receiver */
  const [rxHeight, setRxHeight] = useState(1.5)
  const [rxGain, setRxGain] = useState(0)
  const [rxSensitivity, setRxSensitivity] = useState(-130)
  const [cableLossRx, setCableLossRx] = useState(0.5)

  /* Simulation */
  const [maxRange, setMaxRange] = useState(30)
  const [threshold, setThreshold] = useState(-120)
  const [situationFraction, setSituationFraction] = useState(95)
  const [timeFraction, setTimeFraction] = useState(95)
  const [highRes, setHighRes] = useState(false)

  /* Optimization */
  const [mode, setMode] = useState<'min-sites' | 'max-coverage'>('min-sites')
  const [target, setTarget] = useState(0.95)

  /* Environment */
  const [climate, setClimate] = useState(5)
  const [polarization, setPolarization] = useState(1)
  const [groundPermittivity, setGroundPermittivity] = useState(15.0)
  const [groundConductivity, setGroundConductivity] = useState(0.005)
  const [surfaceRefractivity, setSurfaceRefractivity] = useState(314)
  const [clutterHeight, setClutterHeight] = useState(1.0)

  /* Collapse state */
  const [loraOpen, setLoraOpen] = useState(true)
  const [txOpen, setTxOpen] = useState(true)
  const [rxOpen, setRxOpen] = useState(true)
  const [simOpen, setSimOpen] = useState(true)
  const [optimizationOpen, setOptimizationOpen] = useState(true)
  const [envOpen, setEnvOpen] = useState(false)

  /* Dirty-state tracking snapshot (set on Apply). */
  const snapRef = useRef<FormSnapshot>(EMPTY_SNAPSHOT)
  const [snap, setSnap] = useState<FormSnapshot | null>(null)

  const current: FormSnapshot = {
    band, sf, txPower, txHeight, txGain, cableLossTx,
    rxHeight, rxGain, rxSensitivity, cableLossRx,
    maxRange, threshold, situationFraction, timeFraction, highRes,
    mode, target,
    climate, polarization, groundPermittivity, groundConductivity, surfaceRefractivity, clutterHeight,
  }

  const isDirty = snap !== null && SECTION_FIELDS.lora.concat(
    ...Object.values(SECTION_FIELDS),
  ).some((k) => current[k] !== snap[k])

  const sectionDirty = (id: SectionId): boolean => {
    if (!snap) return false
    return SECTION_FIELDS[id].some((k) => current[k] !== snap[k])
  }

  const toggle = (setter: (v: boolean) => void, current: boolean) =>
    (e: React.KeyboardEvent | React.MouseEvent) => {
      if ('key' in e && (e as React.KeyboardEvent).key !== 'Enter' && (e as React.KeyboardEvent).key !== ' ') return
      if ('key' in e) e.preventDefault()
      setter(!current)
    }

  const handleDeviceChange = (idx: number) => {
    setDeviceIdx(idx)
    if (idx > 0) {
      const d = DEVICE_PROFILES[idx]
      if (d) { setTxPower(d.txPowerDbm); setTxGain(d.txGainDbi) }
    }
  }

  const params: LoraParams = {
    frequencyMhz: BAND_CENTERS[band] ?? 915,
    spreadingFactor: sf,
    txPowerDbm: txPower,
    txHeightM: txHeight,
    rxHeightM: rxHeight,
    txAntennaGainDbi: txGain,
    rxAntennaGainDbi: rxGain,
    rxSensitivityDbm: rxSensitivity,
    bandwidthHz: 125000,
    requiredMarginDb: 10,
    cableLossTxDb: cableLossTx,
    cableLossRxDb: cableLossRx,
    climate,
    polarization,
    groundPermittivity,
    groundConductivity,
    surfaceRefractivity,
  }

  const budget = calculateLinkBudget(params, 140)

  const handleApply = useCallback(() => {
    snapRef.current = current
    setSnap({ ...current })
    onParamsChange?.(params, { maxRangeKm: maxRange, numRadials: 360, stepKm: 0.1, numWorkers: 4, threshold, targetCoverage: target, highRes, clutterHeightM: clutterHeight })
  }, [params, maxRange, threshold, mode, target, highRes, clutterHeight, onParamsChange])

  /* When compute completes, re-snapshot so the dirty state resets. */
  const computing = useStore((s) => s.computing)
  const prevComputing = useRef(computing)
  useEffect(() => {
    if (prevComputing.current && !computing && snapRef.current !== EMPTY_SNAPSHOT) {
      snapRef.current = current
      setSnap({ ...current })
    }
    prevComputing.current = computing
  })

  const sectionHeader = (label: string, id: SectionId, open: boolean, toggleFn: (e: any) => void, testId: string) => {
    const dirty = sectionDirty(id)
    return (
      <div
        role="button"
        tabIndex={0}
        data-testid={testId}
        onClick={toggleFn}
        onKeyDown={toggleFn}
        aria-expanded={open}
        aria-label={`Toggle ${label}`}
        style={{
          marginTop: 8, paddingTop: 6, borderTop: '1px solid var(--border)',
          fontWeight: 600, fontSize: 13, cursor: 'pointer', userSelect: 'none',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {dirty && <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />}
          {label}
        </span>
        <span style={{ transition: 'transform 0.2s', transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }} aria-hidden="true">▶</span>
      </div>
    )
  }

  const btnDirty = isDirty

  return (
    <div style={{ padding: '8px', fontSize: '13px' }}>
      {/* ── LoRa / PHY ── */}
      {sectionHeader('LoRa / PHY', 'lora', loraOpen, toggle(setLoraOpen, loraOpen), 'lora-toggle')}
      {loraOpen && (<div style={{ marginTop: 4 }}>
        <label style={{ display: 'block', marginBottom: 6 }}>
          Band
          <select value={band} onChange={e => setBand(e.target.value)} style={{ marginLeft: 8 }} aria-label="Frequency band">
            {Object.keys(BAND_CENTERS).map(b => <option key={b} value={b}>{b} ({BAND_CENTERS[b]} MHz)</option>)}
          </select>
        </label>
        <label style={{ display: 'block', marginBottom: 6 }}>
          Spreading Factor
          <select value={sf} onChange={e => setSf(Number(e.target.value))} style={{ marginLeft: 8 }} aria-label="Spreading factor">
            {[7,8,9,10,11,12].map(v => <option key={v}>SF{v}</option>)}
          </select>
        </label>
      </div>)}

      {/* ── Transmitter ── */}
      {sectionHeader('Transmitter', 'tx', txOpen, toggle(setTxOpen, txOpen), 'transmitter-toggle')}
      {txOpen && (<div style={{ marginTop: 4 }}>
        <label style={{ display: 'block', marginBottom: 6 }}>
          Device (optional)
          <select value={deviceIdx} onChange={e => handleDeviceChange(Number(e.target.value))} style={{ marginLeft: 8 }} aria-label="Device profile">
            {DEVICE_PROFILES.map((d, i) => <option key={i} value={i}>{d.label}</option>)}
          </select>
        </label>
        <div style={{ marginBottom: 6 }}>TX Power: {txPower} dBm
          <input type="range" min={0} max={30} value={txPower} onChange={e => { setTxPower(Number(e.target.value)); setDeviceIdx(0) }} style={{ width: '100%' }} aria-label="Transmit power in dBm" />
        </div>
        <label style={{ display: 'block', marginBottom: 6 }}>
          Height AGL (m)
          <input type="number" min={1} step={0.1} value={txHeight} onChange={e => setTxHeight(Number(e.target.value))} style={{ marginLeft: 8, width: 70 }} aria-label="Transmitter height" />
        </label>
        <label style={{ display: 'block', marginBottom: 6 }}>
          Antenna Gain (dBi)
          <input type="number" min={0} step={0.1} value={txGain} onChange={e => { setTxGain(Number(e.target.value)); setDeviceIdx(0) }} style={{ marginLeft: 8, width: 70 }} aria-label="TX antenna gain" />
        </label>
        <label style={{ display: 'block', marginBottom: 6 }}>
          Cable Loss (dB)
          <input type="number" min={0} step={0.1} value={cableLossTx} onChange={e => setCableLossTx(Number(e.target.value))} style={{ marginLeft: 8, width: 70 }} aria-label="TX cable loss" />
        </label>
        <button type="button" onClick={() => useStore.getState().triggerCenterOnSite()} style={{ width: '100%', padding: '4px 8px', marginBottom: 6, fontSize: 12 }}>Center on site</button>
        <div style={{ marginTop: 6, padding: 6, background: 'var(--bg-secondary)', borderRadius: 4, fontSize: 12, border: '1px solid var(--border)', color: 'var(--text)' }}>
          <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text-h)' }}>Link Budget (140 dB loss)</div>
          <div>EIRP: {budget.txEirpDbm} dBm | RX: {budget.rxPowerDbm} dBm</div>
          <div>Margin: <span style={{ color: budget.isFeasible ? 'var(--accent)' : '#ef4444', fontWeight: 600 }}>{budget.marginDb} dB</span></div>
        </div>
      </div>)}

      {/* ── Receiver ── */}
      {sectionHeader('Receiver', 'rx', rxOpen, toggle(setRxOpen, rxOpen), 'receiver-toggle')}
      {rxOpen && (<div style={{ marginTop: 4 }}>
        <div style={{ marginBottom: 6 }}>Sensitivity: {rxSensitivity} dBm
          <input type="range" min={-150} max={-80} value={rxSensitivity} onChange={e => setRxSensitivity(Number(e.target.value))} style={{ width: '100%' }} aria-label="Receiver sensitivity" />
        </div>
        <label style={{ display: 'block', marginBottom: 6 }}>
          Height AGL (m)
          <input type="number" min={0} step={0.1} value={rxHeight} onChange={e => setRxHeight(Number(e.target.value))} style={{ marginLeft: 8, width: 70 }} aria-label="Receiver height" />
        </label>
        <label style={{ display: 'block', marginBottom: 6 }}>
          Antenna Gain (dBi)
          <input type="number" min={0} step={0.1} value={rxGain} onChange={e => setRxGain(Number(e.target.value))} style={{ marginLeft: 8, width: 70 }} aria-label="RX antenna gain" />
        </label>
        <label style={{ display: 'block', marginBottom: 6 }}>
          Cable Loss (dB)
          <input type="number" min={0} step={0.1} value={cableLossRx} onChange={e => setCableLossRx(Number(e.target.value))} style={{ marginLeft: 8, width: 70 }} aria-label="RX cable loss" />
        </label>
      </div>)}

      {/* ── Simulation ── */}
      {sectionHeader('Simulation', 'sim', simOpen, toggle(setSimOpen, simOpen), 'simulation-toggle')}
      {simOpen && (<div style={{ marginTop: 4 }}>
        <div style={{ marginBottom: 6 }}>Max Range: {maxRange} km
          <input type="range" min={1} max={highRes ? 70 : 150} value={maxRange} onChange={e => setMaxRange(Number(e.target.value))} style={{ width: '100%' }} aria-label="Maximum range" />
        </div>
        <label style={{ display: 'block', marginBottom: 6 }}>
          Situation Fraction (%)
          <input type="number" min={1} max={100} step={0.1} value={situationFraction} onChange={e => setSituationFraction(Number(e.target.value))} style={{ marginLeft: 8, width: 70 }} aria-label="Situation fraction" />
        </label>
        <label style={{ display: 'block', marginBottom: 6 }}>
          Time Fraction (%)
          <input type="number" min={1} max={100} step={0.1} value={timeFraction} onChange={e => setTimeFraction(Number(e.target.value))} style={{ marginLeft: 8, width: 70 }} aria-label="Time fraction" />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 6 }}>
          <input type="checkbox" checked={highRes} onChange={e => setHighRes(e.target.checked)} aria-label="High resolution terrain" />
          <span>High resolution (30 m)</span>
        </label>
      </div>)}

      {/* ── Optimization ── */}
      {sectionHeader('Optimization', 'optimization', optimizationOpen, toggle(setOptimizationOpen, optimizationOpen), 'optimization-toggle')}
      {optimizationOpen && (<div style={{ marginTop: 4 }}>
        <label>Mode
          <select value={mode} onChange={e => setMode(e.target.value as any)} style={{ marginLeft: 8 }} aria-label="Optimization mode">
            <option value="min-sites">Min Sites</option>
            <option value="max-coverage">Max Coverage</option>
          </select>
        </label>
        {mode === 'min-sites' && (
          <div style={{ marginTop: 4 }}>Target: {(target * 100).toFixed(0)}%
            <input type="range" min={0.5} max={1} step={0.05} value={target} onChange={e => setTarget(Number(e.target.value))} style={{ width: '100%' }} aria-label="Coverage target" />
          </div>
        )}
      </div>)}

      {/* ── Environment ── */}
      {sectionHeader('Environment', 'env', envOpen, toggle(setEnvOpen, envOpen), 'env-toggle')}
      {envOpen && (<div style={{ marginTop: 4 }}>
        <label style={{ display: 'block', marginBottom: 6 }}>
          Climate Zone
          <select value={climate} onChange={e => setClimate(Number(e.target.value))} style={{ marginLeft: 8, maxWidth: 180 }} aria-label="Climate zone">
            {Object.entries(CLIMATE_CODES).map(([code, name]) => (
              <option key={code} value={code}>{code}-{name}</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'block', marginBottom: 6 }}>
          Polarization
          <select value={polarization} onChange={e => setPolarization(Number(e.target.value))} style={{ marginLeft: 8 }} aria-label="Polarization">
            <option value={0}>Horizontal</option>
            <option value={1}>Vertical</option>
          </select>
        </label>
        <label style={{ display: 'block', marginBottom: 6 }}>
          Clutter Height (m)
          <input type="number" min={0} step={0.1} value={clutterHeight} onChange={e => setClutterHeight(Number(e.target.value))} style={{ marginLeft: 8, width: 70 }} aria-label="Clutter height" />
        </label>
        <label style={{ display: 'block', marginBottom: 6 }}>
          Ground Permittivity (ε)
          <input type="number" min={1} max={81} step={0.1} value={groundPermittivity} onChange={e => setGroundPermittivity(Number(e.target.value))} style={{ marginLeft: 8, width: 70 }} aria-label="Ground permittivity" />
        </label>
        <label style={{ display: 'block', marginBottom: 6 }}>
          Ground Conductivity (σ) S/m
          <input type="number" min={0.0001} max={0.1} step={0.0001} value={groundConductivity} onChange={e => setGroundConductivity(Number(e.target.value))} style={{ marginLeft: 8, width: 80 }} aria-label="Ground conductivity" />
        </label>
        <label style={{ display: 'block', marginBottom: 6 }}>
          Surface Refractivity (Nₛ)
          <input type="number" min={200} max={450} step={1} value={surfaceRefractivity} onChange={e => setSurfaceRefractivity(Number(e.target.value))} style={{ marginLeft: 8, width: 70 }} aria-label="Surface refractivity" />
        </label>
      </div>)}

      {/* ── Apply ── */}
      <style>{`
        @keyframes pulse-glow {
          0% { box-shadow: 0 0 0 0 rgba(var(--accent-rgb, 52, 152, 219), 0.5); }
          70% { box-shadow: 0 0 0 8px rgba(var(--accent-rgb, 52, 152, 219), 0); }
          100% { box-shadow: 0 0 0 0 rgba(var(--accent-rgb, 52, 152, 219), 0); }
        }
      `}</style>
      <button
        data-testid="apply-params-btn"
        onClick={handleApply}
        type="button"
        style={{
          marginTop: 8,
          width: '100%',
          padding: '6px 8px',
          fontWeight: btnDirty ? 700 : 500,
          background: btnDirty ? 'var(--accent)' : 'var(--bg-secondary)',
          color: btnDirty ? '#fff' : 'var(--text)',
          border: btnDirty ? 'none' : '1px solid var(--border)',
          borderRadius: 4,
          cursor: 'pointer',
          animation: btnDirty ? 'pulse-glow 2s infinite' : 'none',
          transition: 'background 0.2s, color 0.2s, font-weight 0.2s',
        }}
      >
        {btnDirty ? 'Apply Changes' : 'Apply Parameters'}
      </button>
    </div>
  )
}
