export const LIBRARY_EASE = [0.16, 1, 0.3, 1] as const
export const LIBRARY_SETTLE = { duration: 0.5, ease: LIBRARY_EASE } as const

export const SETTLE_FROM = { opacity: 0, y: -8, filter: 'blur(6px)' }
export const SETTLED = { opacity: 1, y: 0, filter: 'blur(0px)' }

export const LEAVING = { opacity: 0, filter: 'blur(4px)', transition: { duration: 0.18, ease: LIBRARY_EASE } }
