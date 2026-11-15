export function slideFit(aspect: number): { width: string } {
    return { width: `min(100cqw, calc(100cqh * ${aspect}))` }
}
