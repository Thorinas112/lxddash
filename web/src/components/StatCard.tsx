export default function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string
  value: string
  sub?: string
  accent?: string
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="text-[11px] font-medium text-gray-500">{label}</div>
      <div className={`mt-1.5 text-2xl font-semibold tabular-nums ${accent || 'text-gray-900'}`}>
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-gray-500">{sub}</div>}
    </div>
  )
}