import type { ComposerMention } from '@/lib/chat/composer-links'

// On the user's sent bubble (`data-ink`), violet in both themes, a token keeps its hue in the pale
// 300 shade, the darker light-theme ones would sink into the violet. On the bubble of another brand
// none of them is sure to read: `--bubble-token` gives them the bubble's ink.
export const MENTION_TOKEN_CLASSES: Record<ComposerMention['kind'], string> = {
    agent: 'text-violet-700 dark:text-violet-300 in-data-ink:text-[var(--bubble-token,var(--color-violet-300))]!',
    skill: 'text-amber-700 dark:text-amber-300 in-data-ink:text-[var(--bubble-token,var(--color-amber-300))]!',
    computer: 'text-emerald-700 dark:text-emerald-300 in-data-ink:text-[var(--bubble-token,var(--color-emerald-300))]!',
}

export const LINK_TOKEN_CLASS = 'text-cyan-700 dark:text-cyan-300 in-data-ink:text-[var(--bubble-token,var(--color-cyan-300))]!'
