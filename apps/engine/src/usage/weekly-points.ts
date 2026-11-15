export type UsageReading = { capturedAt: string; usedPercent: number; resetsAt: string | null }
export type UsageSpend = { at: string; key: string; tokens: number }

const round2 = (x: number) => Math.round(x * 100) / 100

export function attributeWeeklyPoints(
  readings: UsageReading[],
  spends: UsageSpend[],
): { points: Record<string, number>; unassigned: number } {
  if (readings.length < 2) return { points: {}, unassigned: 0 }
  const sorted = [...readings].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
  const sums: Record<string, number> = {}
  let unassigned = 0
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1]!
    const b = sorted[i]!
    const restarted = b.resetsAt !== a.resetsAt || b.usedPercent < a.usedPercent
    const movement = restarted ? b.usedPercent : b.usedPercent - a.usedPercent
    if (movement <= 0) continue
    const inside = spends.filter((s) => a.capturedAt < s.at && s.at <= b.capturedAt)
    const total = inside.reduce((n, s) => n + s.tokens, 0)
    if (total <= 0) {
      unassigned += movement
      continue
    }
    for (const s of inside) {
      sums[s.key] = (sums[s.key] ?? 0) + (movement * s.tokens) / total
    }
  }
  const points: Record<string, number> = {}
  for (const key of Object.keys(sums)) points[key] = round2(sums[key]!)
  return { points, unassigned: round2(unassigned) }
}
