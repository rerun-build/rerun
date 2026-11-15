export type AppSlug = string

export const APP_SLUGS: readonly AppSlug[] = []

export function isAppSlug(_value: string | null | undefined): _value is AppSlug {
    return false
}
