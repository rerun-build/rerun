import type { MessageTree } from './merge'

// The name a pack takes when nobody else's is known: Rerun's own surfaces.
export const DEFAULT_BRAND_NAME = 'Rerun'

const BRAND_ARGUMENT = '{brand}'

// A name lands inside ICU messages: what ICU reads as syntax is taken out, and the apostrophe takes
// its typographic form, which is never an escape.
function icuSafe(name: string): string {
    return name.replace(/[{}<>#|]/g, '').replaceAll("'", '’')
}

// `{brand}` is filled when the pack loads, not by each caller: a string says the name of the product
// without every screen passing it, and a pack already filled comes back as it is.
export function fillBrand<T extends MessageTree>(tree: T, name: string = DEFAULT_BRAND_NAME): T {
    const safe = icuSafe(name)
    const fill = (node: MessageTree): MessageTree =>
        Object.fromEntries(Object.entries(node).map(([key, value]) => [key, typeof value === 'object' ? fill(value) : value.includes(BRAND_ARGUMENT) ? value.replaceAll(BRAND_ARGUMENT, () => safe) : value]))
    return fill(tree) as T
}
