function readString(metadata: Record<string, unknown> | undefined, key: string): string {
    const value = metadata?.[key]
    return typeof value === 'string' ? value.trim() : ''
}

export function readFirstName(metadata: Record<string, unknown> | undefined): string {
    const firstName = readString(metadata, 'first_name') || readString(metadata, 'given_name')
    if (firstName) return firstName

    const full = readString(metadata, 'full_name') || readString(metadata, 'name')
    return full.split(/\s+/)[0] ?? ''
}
