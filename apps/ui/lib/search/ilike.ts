export function sanitizeIlike(q: string): string {
    return q.replace(/[%_]/g, ' ').trim()
}
