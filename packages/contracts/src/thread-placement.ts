export type ThreadPlacement<T> = {
    leading: T[]
    after: Map<number, T[]>
}

const timeOf = (iso: string) => new Date(iso).getTime()

export function threadsByMessage<T extends { createdAt: string }>(messageTimes: readonly string[], threads: readonly T[]): ThreadPlacement<T> {
    const leading: T[] = []
    const after = new Map<number, T[]>()
    const times = messageTimes.map(timeOf)
    const ordered = [...threads].sort((a, b) => timeOf(a.createdAt) - timeOf(b.createdAt))
    for (const thread of ordered) {
        const opened = timeOf(thread.createdAt)
        let anchor = -1
        for (let i = 0; i < times.length; i++) {
            if (times[i] <= opened) anchor = i
        }
        if (anchor === -1) {
            leading.push(thread)
            continue
        }
        const list = after.get(anchor) ?? []
        list.push(thread)
        after.set(anchor, list)
    }
    return { leading, after }
}
