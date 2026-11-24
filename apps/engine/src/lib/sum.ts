export const sum = (a: number | undefined, b: number | undefined): number | undefined => (a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0))
