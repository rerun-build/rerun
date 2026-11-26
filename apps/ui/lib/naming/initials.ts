// The letters an avatar shows when it has no picture: the first letter of the first two words.
export function initialsOf(name: string): string {
    return name
        .split(/\s+/)
        .slice(0, 2)
        .map(word => word.charAt(0))
        .join('')
        .toUpperCase()
}
