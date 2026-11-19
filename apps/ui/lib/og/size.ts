export const OG_WIDTH = 1200
export const OG_HEIGHT = 630

export const OG_SCALE = 2

export { CARD_HEIGHT, CARD_MAX_ZOOM, CARD_WIDTH } from '@moldwright/ui/iso-grid/card-capture'

export const CARD_SCALE = 2

export const CARD_THEMES = ['dark', 'light'] as const
export type CardTheme = (typeof CARD_THEMES)[number]
export const CARD_BACKGROUND: Record<CardTheme, string> = { dark: '#0a0a0a', light: '#fafafa' }
export const CARD_THEME: CardTheme = 'dark'
