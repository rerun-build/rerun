import { z } from 'zod'

// What a coworker's buddy can wear. The order of each list is part of the drawing: a coworker nobody
// dressed gets the entry its id hashes to, so reordering one would change every such buddy.
export const COWORKER_EYES = ['pill', 'round', 'happy', 'googly', 'visor', 'sleepy', 'wink', 'pixel', 'star', 'heart', 'dot', 'brows', 'cyclops', 'shades', 'glasses', 'sparkle', 'line'] as const
export const COWORKER_MOUTHS = ['none', 'smile', 'open', 'cat', 'flat'] as const
// Amber, red and cyan are left out: on the board they mean working, broken and waiting for you.
export const COWORKER_COLORS = ['#0f52ff', '#4fb800', '#f0127f', '#7a2cf5', '#e935c1', '#3b32e8', '#00b862', '#a81fe0'] as const
// From the softest to the hardest. `classic` is the block drawn before materials existed, and what a
// look without one wears: no id ever hashes to another.
export const COWORKER_MATERIALS = ['classic', 'fluffy', 'plush', 'felt', 'knit', 'clay', 'rubber', 'glass', 'chrome'] as const

export const coworkerLookSchema = z.object({
    eyes: z.enum(COWORKER_EYES),
    mouth: z.enum(COWORKER_MOUTHS),
    color: z.enum(COWORKER_COLORS),
    material: z.enum(COWORKER_MATERIALS).optional(),
})
export type CoworkerLook = z.infer<typeof coworkerLookSchema>

// A look read back from storage, null when it is missing or no longer one the buddy can wear.
export function parseCoworkerLook(value: unknown): CoworkerLook | null {
    const parsed = coworkerLookSchema.safeParse(value)
    return parsed.success ? parsed.data : null
}
