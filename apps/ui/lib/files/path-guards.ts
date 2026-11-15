export function invalidName(name: string): boolean {
    return !name || name.includes('/') || name.includes('\\') || name === '..' || new TextEncoder().encode(name).length > 255
}

export function invalidDir(dir: string): boolean {
    return dir.startsWith('/') || dir.split(/[/\\]/).includes('..')
}
