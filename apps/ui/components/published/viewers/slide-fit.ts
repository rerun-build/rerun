// A slide of this aspect, as large as the stage (a size container) lets it be on both axes.
export function slideFit(aspect: number): { width: string } {
    return { width: `min(100cqw, calc(100cqh * ${aspect}))` }
}
