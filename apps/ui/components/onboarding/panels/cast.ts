import type { BuddyLook } from '@rerun/ui/iso-grid'

export type CastMember = { id: string; name: string; look: BuddyLook }

const classic = (look: Omit<BuddyLook, 'material'>): BuddyLook => ({ ...look, material: 'classic' })

// The coworkers the panels of the onboarding show: nobody's real coworkers, always the same faces.
export const CAST = [
    { id: 'onboarding-nova', name: 'Nova', look: classic({ color: '#0f52ff', eyes: 'happy', mouth: 'smile' }) },
    { id: 'onboarding-atlas', name: 'Atlas', look: classic({ color: '#00b862', eyes: 'visor', mouth: 'none' }) },
    { id: 'onboarding-iris', name: 'Iris', look: classic({ color: '#e935c1', eyes: 'star', mouth: 'cat' }) },
    { id: 'onboarding-sol', name: 'Sol', look: classic({ color: '#7a2cf5', eyes: 'round', mouth: 'open' }) },
    { id: 'onboarding-pico', name: 'Pico', look: classic({ color: '#4fb800', eyes: 'pixel', mouth: 'flat' }) },
] as const satisfies readonly CastMember[]

export const CAST_LOOKS: ReadonlyMap<string, BuddyLook> = new Map(CAST.map(member => [member.id, member.look]))

export const [NOVA, ATLAS, IRIS, , PICO] = CAST
