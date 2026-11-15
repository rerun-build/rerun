let pending: string | null = null

export function setPendingAsk(text: string) {
    pending = text
}

export function takePendingAsk(): string | undefined {
    const text = pending ?? undefined
    pending = null
    return text
}
