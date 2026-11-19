// How many times the components that call `noteRender` drew since `countRenders` started. Off
// everywhere else: outside a perf test or the perf lab, `noteRender` returns at once.
let counts: Map<string, number> | null = null

export type RenderCounts = Record<string, number>

export function countRenders(): () => RenderCounts {
    counts = new Map()
    return () => Object.fromEntries(counts ?? [])
}

export function stopCountingRenders() {
    counts = null
}

export function noteRender(name: string) {
    if (counts) counts.set(name, (counts.get(name) ?? 0) + 1)
}
