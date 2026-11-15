import type { ColorScheme } from '@/theme/tokens'

const shadows = (...layers: string[]) => layers.join(', ')

type Relief = Record<ColorScheme, { rest: string; pressed: string }>

export const ctaRelief: Relief = {
    light: {
        rest: shadows(
            'inset 0 2px 0 0 rgba(255, 255, 255, 0.2)',
            'inset 2px 0 0 0 rgba(255, 255, 255, 0.09)',
            'inset -2px 0 0 0 rgba(255, 255, 255, 0.09)',
            'inset 0 12px 14px -10px rgba(255, 255, 255, 0.14)',
            'inset 14px 0 16px -14px rgba(255, 255, 255, 0.18)',
            'inset -14px 0 16px -14px rgba(255, 255, 255, 0.18)',
            'inset 0 22px 22px -20px rgba(255, 255, 255, 0.3)',
            '0 1px 2px 0 rgba(0, 0, 0, 0.22)',
            '0 5px 14px -8px rgba(0, 0, 0, 0.3)',
        ),
        pressed: shadows(
            'inset 0 2px 0 0 rgba(255, 255, 255, 0.26)',
            'inset 2px 0 0 0 rgba(255, 255, 255, 0.12)',
            'inset -2px 0 0 0 rgba(255, 255, 255, 0.12)',
            'inset 0 12px 14px -10px rgba(255, 255, 255, 0.2)',
            'inset 14px 0 16px -14px rgba(255, 255, 255, 0.25)',
            'inset -14px 0 16px -14px rgba(255, 255, 255, 0.25)',
            'inset 0 22px 22px -20px rgba(255, 255, 255, 0.42)',
            '0 1px 2px 0 rgba(0, 0, 0, 0.26)',
            '0 8px 20px -10px rgba(0, 0, 0, 0.35)',
        ),
    },
    dark: {
        rest: shadows(
            'inset 0 2px 0 0 rgba(255, 255, 255, 0.9)',
            'inset 2px 0 0 0 rgba(255, 255, 255, 0.5)',
            'inset -2px 0 0 0 rgba(255, 255, 255, 0.5)',
            'inset 0 12px 14px -10px rgba(255, 255, 255, 0.45)',
            'inset 14px 0 16px -14px rgba(255, 255, 255, 0.55)',
            'inset -14px 0 16px -14px rgba(255, 255, 255, 0.55)',
            'inset 0 -1px 0 0 rgba(0, 0, 0, 0.14)',
            'inset 0 -22px 22px -18px rgba(0, 0, 0, 0.16)',
            '0 1px 2px 0 rgba(0, 0, 0, 0.5)',
            '0 6px 18px -8px rgba(0, 0, 0, 0.55)',
        ),
        pressed: shadows(
            'inset 0 2px 0 0 rgba(255, 255, 255, 1)',
            'inset 2px 0 0 0 rgba(255, 255, 255, 0.65)',
            'inset -2px 0 0 0 rgba(255, 255, 255, 0.65)',
            'inset 0 12px 14px -10px rgba(255, 255, 255, 0.6)',
            'inset 14px 0 16px -14px rgba(255, 255, 255, 0.7)',
            'inset -14px 0 16px -14px rgba(255, 255, 255, 0.7)',
            'inset 0 -1px 0 0 rgba(0, 0, 0, 0.08)',
            'inset 0 -22px 22px -18px rgba(0, 0, 0, 0.07)',
            '0 1px 2px 0 rgba(0, 0, 0, 0.5)',
            '0 8px 24px -10px rgba(255, 255, 255, 0.15)',
        ),
    },
}

export const solidRelief: Relief = {
    light: {
        rest: shadows(
            'inset 0 1px 0 0 rgba(255, 255, 255, 0.18)',
            'inset 1px 0 0 0 rgba(255, 255, 255, 0.08)',
            'inset -1px 0 0 0 rgba(255, 255, 255, 0.08)',
            'inset 0 8px 10px -8px rgba(255, 255, 255, 0.16)',
            'inset 0 14px 14px -13px rgba(255, 255, 255, 0.26)',
            '0 1px 2px 0 rgba(0, 0, 0, 0.18)',
            '0 3px 8px -5px rgba(0, 0, 0, 0.24)',
        ),
        pressed: shadows(
            'inset 0 1px 0 0 rgba(255, 255, 255, 0.24)',
            'inset 1px 0 0 0 rgba(255, 255, 255, 0.11)',
            'inset -1px 0 0 0 rgba(255, 255, 255, 0.11)',
            'inset 0 8px 10px -8px rgba(255, 255, 255, 0.22)',
            'inset 0 14px 14px -13px rgba(255, 255, 255, 0.36)',
            '0 1px 2px 0 rgba(0, 0, 0, 0.22)',
            '0 5px 12px -6px rgba(0, 0, 0, 0.28)',
        ),
    },
    dark: {
        rest: shadows(
            'inset 0 1px 0 0 rgba(255, 255, 255, 0.85)',
            'inset 1px 0 0 0 rgba(255, 255, 255, 0.45)',
            'inset -1px 0 0 0 rgba(255, 255, 255, 0.45)',
            'inset 0 8px 10px -8px rgba(255, 255, 255, 0.4)',
            'inset 0 -1px 0 0 rgba(0, 0, 0, 0.12)',
            'inset 0 -14px 14px -12px rgba(0, 0, 0, 0.14)',
            '0 1px 2px 0 rgba(0, 0, 0, 0.45)',
            '0 4px 12px -6px rgba(0, 0, 0, 0.5)',
        ),
        pressed: shadows(
            'inset 0 1px 0 0 rgba(255, 255, 255, 1)',
            'inset 1px 0 0 0 rgba(255, 255, 255, 0.6)',
            'inset -1px 0 0 0 rgba(255, 255, 255, 0.6)',
            'inset 0 8px 10px -8px rgba(255, 255, 255, 0.55)',
            'inset 0 -1px 0 0 rgba(0, 0, 0, 0.06)',
            'inset 0 -14px 14px -12px rgba(0, 0, 0, 0.06)',
            '0 1px 2px 0 rgba(0, 0, 0, 0.45)',
            '0 5px 14px -6px rgba(255, 255, 255, 0.12)',
        ),
    },
}

export const subtleRelief: Relief = {
    light: {
        rest: shadows(
            'inset 0 1px 0 0 rgba(255, 255, 255, 0.85)',
            'inset 0 -1px 0 0 rgba(0, 0, 0, 0.04)',
            '0 1px 1px 0 rgba(0, 0, 0, 0.05)',
            '0 2px 6px -4px rgba(0, 0, 0, 0.12)',
        ),
        pressed: shadows(
            'inset 0 1px 0 0 rgba(255, 255, 255, 1)',
            'inset 0 -1px 0 0 rgba(0, 0, 0, 0.05)',
            '0 1px 1px 0 rgba(0, 0, 0, 0.06)',
            '0 3px 8px -4px rgba(0, 0, 0, 0.16)',
        ),
    },
    dark: {
        rest: shadows(
            'inset 0 1px 0 0 rgba(255, 255, 255, 0.08)',
            'inset 0 8px 10px -8px rgba(255, 255, 255, 0.05)',
            'inset 0 -1px 0 0 rgba(0, 0, 0, 0.2)',
            '0 1px 2px 0 rgba(0, 0, 0, 0.4)',
            '0 3px 8px -5px rgba(0, 0, 0, 0.45)',
        ),
        pressed: shadows(
            'inset 0 1px 0 0 rgba(255, 255, 255, 0.14)',
            'inset 0 8px 10px -8px rgba(255, 255, 255, 0.08)',
            'inset 0 -1px 0 0 rgba(0, 0, 0, 0.22)',
            '0 1px 2px 0 rgba(0, 0, 0, 0.45)',
            '0 4px 12px -6px rgba(0, 0, 0, 0.5)',
        ),
    },
}

export const destructiveRelief: Relief = {
    light: {
        rest: shadows(
            'inset 0 -1px 0 0 rgba(150, 20, 20, 0.12)',
            'inset 0 -8px 8px -8px rgba(150, 20, 20, 0.1)',
            '0 1px 1px 0 rgba(150, 20, 20, 0.06)',
            '0 2px 5px -4px rgba(180, 25, 25, 0.14)',
        ),
        pressed: shadows(
            'inset 0 -1px 0 0 rgba(150, 20, 20, 0.16)',
            'inset 0 -8px 8px -8px rgba(150, 20, 20, 0.14)',
            '0 1px 1px 0 rgba(150, 20, 20, 0.08)',
            '0 3px 8px -4px rgba(210, 35, 35, 0.2)',
        ),
    },
    dark: {
        rest: shadows(
            'inset 0 1px 0 0 rgba(255, 150, 150, 0.32)',
            'inset 0 8px 10px -8px rgba(255, 130, 130, 0.14)',
            'inset 0 -1px 0 0 rgba(0, 0, 0, 0.25)',
            '0 1px 2px 0 rgba(0, 0, 0, 0.3)',
            '0 3px 8px -6px rgba(190, 30, 30, 0.24)',
        ),
        pressed: shadows(
            'inset 0 1px 0 0 rgba(255, 170, 170, 0.5)',
            'inset 0 8px 10px -8px rgba(255, 140, 140, 0.22)',
            'inset 0 -1px 0 0 rgba(0, 0, 0, 0.28)',
            '0 1px 2px 0 rgba(0, 0, 0, 0.35)',
            '0 4px 12px -6px rgba(240, 50, 50, 0.28)',
        ),
    },
}
