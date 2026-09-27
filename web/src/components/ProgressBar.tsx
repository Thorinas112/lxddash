export default function ProgressBar({ percent, color = 'bg-blue-500' }: { percent: number; color?: string }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded bg-gray-200">
      <div
        className={`h-full rounded transition-all ${color}`}
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </div>
  )
}