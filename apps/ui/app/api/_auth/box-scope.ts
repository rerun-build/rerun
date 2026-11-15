export type BoxScope = 'all' | 'assigned'

export function toBoxScope(value: string | null | undefined): BoxScope {
    return value === 'assigned' ? 'assigned' : 'all'
}
