// Where someone stopped reading a conversation, as how far above its end, for as long as the app runs:
// coming back to it opens there rather than at the end. Nothing for one left at its end.
const LIMIT = 50
const places = new Map<string, number>()

export function rememberPlace(sessionId: string, aboveEnd: number | null) {
    places.delete(sessionId)
    if (aboveEnd === null) return
    places.set(sessionId, aboveEnd)
    if (places.size > LIMIT) places.delete(places.keys().next().value!)
}

export function placeOf(sessionId: string): number | null {
    return places.get(sessionId) ?? null
}
