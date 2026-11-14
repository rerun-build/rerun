export const PLACEHOLDER_EFFECTS = ['roll', 'type', 'fade', 'letters', 'static'] as const
export type PlaceholderEffect = (typeof PLACEHOLDER_EFFECTS)[number]
export const DEFAULT_PLACEHOLDER_EFFECT: PlaceholderEffect = 'roll'
