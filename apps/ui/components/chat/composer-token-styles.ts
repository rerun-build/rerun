import type { ComposerMention } from '@/lib/chat/composer-links'

export const MENTION_TOKEN_CLASSES: Record<ComposerMention['kind'], string> = {
    agent: 'text-violet-700 dark:text-violet-300 in-data-ink:text-violet-300!',
    skill: 'text-amber-700 dark:text-amber-300 in-data-ink:text-amber-300!',
}

export const LINK_TOKEN_CLASS = 'text-cyan-700 dark:text-cyan-300 in-data-ink:text-cyan-300!'
