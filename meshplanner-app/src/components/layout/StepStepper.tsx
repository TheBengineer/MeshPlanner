import { type KeyboardEvent, type ReactNode } from 'react'

interface StepStepperProps {
  currentStep: number
  onStepClick: (index: number) => void
}

const STEPS = ['Area', 'Mark Sites', 'Import', 'Configure']

const containerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  width: '100%',
  padding: '16px 0',
}

const stepGroupStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
}

const stepBtnStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  cursor: 'pointer',
  border: 'none',
  background: 'none',
  padding: 0,
  outline: 'none',
}

function circleStyle(isActive: boolean, isCompleted: boolean): React.CSSProperties {
  return {
    width: 32,
    height: 32,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 14,
    fontWeight: 700,
    transition: 'background 0.15s, color 0.15s',
    background: isActive ? '#3498db' : isCompleted ? '#27ae60' : '#ccc',
    color: '#fff',
  }
}

function labelStyle(isActive: boolean, isCompleted: boolean): React.CSSProperties {
  const color = isActive ? '#3498db' : isCompleted ? '#27ae60' : '#999'
  return {
    marginTop: 4,
    fontSize: 11,
    fontWeight: isActive ? 600 : 400,
    color,
    whiteSpace: 'nowrap',
  }
}

function connectorStyle(isCompleted: boolean): React.CSSProperties {
  return {
    width: 48,
    height: 0,
    borderTop: isCompleted ? '2px solid #27ae60' : '2px dashed #ccc',
    marginTop: 15,
    marginLeft: 6,
    marginRight: 6,
  }
}

export function StepStepper({ currentStep, onStepClick }: StepStepperProps): ReactNode {
  const handleKeyDown = (index: number) => (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onStepClick(index)
    }
  }

  return (
    <div data-testid="step-stepper" style={containerStyle}>
      {STEPS.map((label, i) => {
        const isActive = i === currentStep
        const isCompleted = i < currentStep

        return (
          <div key={label} style={stepGroupStyle}>
            <div
              role="button"
              tabIndex={0}
              aria-label={`Step ${i + 1}: ${label}${isActive ? ' (current)' : ''}`}
              aria-current={isActive ? 'step' : undefined}
              data-testid={`step-${i}`}
              onClick={() => onStepClick(i)}
              onKeyDown={handleKeyDown(i)}
              style={stepBtnStyle}
            >
              <div style={circleStyle(isActive, isCompleted)}>
                {isCompleted ? '✓' : i + 1}
              </div>
              <span style={labelStyle(isActive, isCompleted)}>
                {`${i + 1}. ${label}`}
              </span>
            </div>

            {i < STEPS.length - 1 && (
              <div style={connectorStyle(isCompleted)} />
            )}
          </div>
        )
      })}
    </div>
  )
}
