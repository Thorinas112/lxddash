import { ReactNode, useState } from 'react'
import Modal from './Modal'

// Wizard is a reusable multi-step modal. Each step is a function
// receiving the current form state and a setter. The footer renders
// Back / Next / Finish buttons with validation.
export default function Wizard({
  title,
  steps,
  onClose,
  onFinish,
  busy,
  finishLabel = 'Create',
}: {
  title: string
  steps: {
    label: string
    valid?: boolean
    body: ReactNode
  }[]
  onClose: () => void
  onFinish: () => void
  busy?: boolean
  finishLabel?: string
}) {
  const [step, setStep] = useState(0)
  const last = step === steps.length - 1

  return (
    <Modal title={title} onClose={onClose}>
      {/* Step indicator */}
      <div className="mb-4 flex items-center gap-1">
        {steps.map((s, i) => (
          <div key={s.label} className="flex flex-1 items-center gap-1">
            <div
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                i === step
                  ? 'bg-blue-600 text-white'
                  : i < step
                    ? 'bg-green-100 text-green-700'
                    : 'bg-gray-100 text-gray-400'
              }`}
            >
              {i < step ? '✓' : i + 1}
            </div>
            <span
              className={`hidden truncate text-[11px] font-medium sm:block ${
                i === step ? 'text-gray-900' : 'text-gray-400'
              }`}
            >
              {s.label}
            </span>
            {i < steps.length - 1 && <div className="mx-1 h-px flex-1 bg-gray-200" />}
          </div>
        ))}
      </div>

      {/* Step body */}
      <div className="min-h-[180px]">{steps[step].body}</div>

      {/* Footer */}
      <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-3">
        <button
          onClick={step === 0 ? onClose : () => setStep(step - 1)}
          className="rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
        >
          {step === 0 ? 'Cancel' : '← Back'}
        </button>
        {last ? (
          <button
            onClick={onFinish}
            disabled={busy || !steps.every((s) => s.valid !== false)}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {busy ? 'Working…' : finishLabel}
          </button>
        ) : (
          <button
            onClick={() => setStep(step + 1)}
            disabled={steps[step].valid === false}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            Next →
          </button>
        )}
      </div>
    </Modal>
  )
}