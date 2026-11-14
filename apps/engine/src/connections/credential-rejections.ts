const rejected = new Set<string>()

export function recordCredentialRejected(connectionId: string): void {
    rejected.add(connectionId)
}

export function isCredentialRejected(connectionId: string): boolean {
    return rejected.has(connectionId)
}

export function forgetCredentialRejected(connectionId: string): void {
    rejected.delete(connectionId)
}
