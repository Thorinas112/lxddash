export const inputCls =
  'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20'

export const btnPrimary =
  'rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50'

export const btnGhost =
  'rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50'

// btnAction builds a small, professional action button. The color
// argument is a Tailwind color class string like "bg-green-100
// text-green-700"; we extract the color name and render a subtle
// bordered button instead of a pastel fill.
export const btnAction = (color: string) => {
  const m = color.match(/text-([a-z]+)-700/)
  const c = m ? m[1] : 'gray'
  return `rounded border border-gray-200 px-2 py-1 text-xs font-medium text-${c}-700 hover:bg-${c}-50`
}