import { useState, useCallback } from 'react'
import { calculateLinkBudget, SF_SENSITIVITY, BAND_CENTERS } from '@/lib/math/link-budget'
import type { LoraParams } from '@/lib/types'

const CLIMATE_CODES: Record<number, string> = {
  1: 'Equatorial',
  2: 'Continental Subtropical',
  3: 'Maritime Subtropical',
  4: 'Desert',
  5: 'Continental Temperate',
  6: 'Maritime Temperate (land)',
  7: 'Maritime Temperate (sea)',
}

interface LoraParamsFormProps {
  onParamsChange?: (params: LoraParams, coverageKwargs: Record<string, number>) => void
}

export function LoraParamsForm({ onParamsChange }: LoraParamsFormProps) {
  const [band, setBand] = useState('US915')
  const [sf, setSf] = useState(10)
  const [txPower, setTxPower] = useState(20)
  const [txHeight, setTxHeight] = useState(10)
  const [maxRange, setMaxRange] = useState(30)
  const [threshold, setThreshold] = useState(-120)
  const [mode, setMode] = useState<'min-sites' | 'max-coverage'>('min-sites')
  const [target, setTarget] = useState(0.95)

  /* Advanced ITM parameters */
  const [climate, setClimate] = useState(5)
  const [polarization, setPolarization] = useState(1)
  const [groundPermittivity, setGroundPermittivity] = useState(15.0)
  const [groundConductivity, setGroundConductivity] = useState(0.005)
  const [surfaceRefractivity, setSurfaceRefractivity] = useState(314)
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const params: LoraParams = {
    frequencyMhz: BAND_CENTERS[band] ?? 915,
    spreadingFactor: sf,
    txPowerDbm: txPower,
    txHeightM: txHeight,
    rxHeightM: 1.5,
    txAntennaGainDbi: 3,
    rxAntennaGainDbi: 0,
    rxSensitivityDbm: SF_SENSITIVITY[sf] ?? -132,
    bandwidthHz: 125000,
    requiredMarginDb: 10,
    cableLossTxDb: 0.5,
    cableLossRxDb: 0.5,
    climate,
    polarization,
    groundPermittivity,
    groundConductivity,
    surfaceRefractivity,
  }

  const budget = calculateLinkBudget(params, 140)

  const handleApply = useCallback(() => {
    onParamsChange?.(params, { maxRangeKm: maxRange, numRadials: 360, stepKm: 0.1, numWorkers: 4, threshold: threshold, targetCoverage: target })
  }, [params, maxRange, threshold, mode, target, onParamsChange])

  return (
    <div style={{ padding: '8px', fontSize: '13px' }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>LoRa Parameters</div>
      
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
      
      <div style={{ marginBottom: 6 }}>TX Power: {txPower} dBm
        <input type="range" min={0} max={30} value={txPower} onChange={e => setTxPower(Number(e.target.value))} style={{ width: '100%' }} aria-label="Transmit power in dBm" />
      </div>
      
      <div style={{ marginBottom: 6 }}>Max Range: {maxRange} km
        <input type="range" min={5} max={100} value={maxRange} onChange={e => setMaxRange(Number(e.target.value))} style={{ width: '100%' }} aria-label="Maximum range in kilometers" />
      </div>
      
      <div style={{ marginBottom: 6 }}>Threshold: {threshold} dBm
        <input type="range" min={-150} max={-80} value={threshold} onChange={e => setThreshold(Number(e.target.value))} style={{ width: '100%' }} aria-label="RSSI threshold in dBm" />
      </div>
      
      <div style={{ marginTop: 8, padding: 6, background: '#f0f0f0', borderRadius: 4, fontSize: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Link Budget (140 dB loss)</div>
        <div>EIRP: {budget.txEirpDbm} dBm | RX: {budget.rxPowerDbm} dBm</div>
        <div>Margin: <span style={{ color: budget.isFeasible ? 'green' : 'red', fontWeight: 600 }}>{budget.marginDb} dB</span></div>
      </div>

      <div style={{ marginTop: 8 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Optimization</div>
        <label>Mode
          <select value={mode} onChange={e => setMode(e.target.value as any)} style={{ marginLeft: 8 }} aria-label="Optimization mode">
            <option value="min-sites">Min Sites</option>
            <option value="max-coverage">Max Coverage</option>
          </select>
        </label>
        {mode === 'min-sites' && (
          <div style={{ marginTop: 4 }}>Target: {(target * 100).toFixed(0)}%
            <input type="range" min={0.5} max={1} step={0.05} value={target} onChange={e => setTarget(Number(e.target.value))} style={{ width: '100%' }} aria-label="Coverage target percentage" />
          </div>
        )}
      </div>
      
      {/* Advanced ITM Parameters — collapsible */}
      <div style={{ marginTop: 8, borderTop: '1px solid #ddd', paddingTop: 6 }}>
        <div
          role="button"
          tabIndex={0}
          data-testid="advanced-itm-toggle"
          onClick={() => setAdvancedOpen(v => !v)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setAdvancedOpen(v => !v) } }}
          aria-expanded={advancedOpen}
          aria-label="Toggle advanced ITM parameters"
          style={{ fontWeight: 600, fontSize: 13, cursor: 'pointer', userSelect: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        >
          Advanced ITM Parameters
          <span style={{ transition: 'transform 0.2s', transform: advancedOpen ? 'rotate(90deg)' : 'rotate(0deg)' }} aria-hidden="true">▶</span>
        </div>

        {advancedOpen && (
          <div style={{ marginTop: 6, paddingLeft: 4 }} data-testid="advanced-itm-section">
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
              Ground Permittivity (ε)
              <input
                type="number"
                min={1}
                max={81}
                step={0.1}
                value={groundPermittivity}
                onChange={e => setGroundPermittivity(Number(e.target.value))}
                style={{ marginLeft: 8, width: 70 }}
                aria-label="Ground permittivity"
              />
            </label>

            <label style={{ display: 'block', marginBottom: 6 }}>
              Ground Conductivity (σ) S/m
              <input
                type="number"
                min={0.0001}
                max={0.1}
                step={0.0001}
                value={groundConductivity}
                onChange={e => setGroundConductivity(Number(e.target.value))}
                style={{ marginLeft: 8, width: 80 }}
                aria-label="Ground conductivity"
              />
            </label>

            <label style={{ display: 'block', marginBottom: 6 }}>
              Surface Refractivity (Nₛ)
              <input
                type="number"
                min={200}
                max={450}
                step={1}
                value={surfaceRefractivity}
                onChange={e => setSurfaceRefractivity(Number(e.target.value))}
                style={{ marginLeft: 8, width: 70 }}
                aria-label="Surface refractivity"
              />
            </label>
          </div>
        )}
      </div>

      <button data-testid="apply-params-btn" onClick={handleApply} style={{ marginTop: 8, width: '100%', padding: '4px 8px' }} type="button">Apply Parameters</button>
    </div>
  )
}
