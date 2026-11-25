import { brandDiscretionNote, brandedText, engineBrandOf, isWhiteLabel, type Brand } from '@rerun/contracts'

// A text the hub wrote for a model or a person, said under the name of the brand. Never for what
// somebody else wrote (a message, a page, a row).
export function brandText(text: string, brand: Brand): string {
    return brandedText(text, engineBrandOf(brand))
}

// What a model is told once so the word never reaches the person. Empty for Rerun.
export function brandDiscretion(brand: Brand): string {
    return brandDiscretionNote(engineBrandOf(brand))
}

// Where the clients of an organization turn to, when nothing in the app answers them.
export function brandContact(brand: Brand): string {
    return brand.supportEmail ?? `the people who set up ${brand.name} for them`
}

// Every `description` inside a value Rerun wrote: a tool and its parameters, an app of the library.
export function brandDescriptions<T>(value: T, brand: Brand): T {
    if (!isWhiteLabel(brand)) return value
    if (Array.isArray(value)) return value.map(entry => brandDescriptions(entry, brand)) as T
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, key === 'description' && typeof entry === 'string' ? brandText(entry, brand) : brandDescriptions(entry, brand)])) as T
}

// The tools handed to a model, under the brand.
export function brandTools<T>(tools: readonly T[], brand: Brand): T[] {
    return tools.map(tool => brandDescriptions(tool, brand))
}
