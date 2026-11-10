import type { BoxAccess } from '@/app/api/_auth/access'
import { useTranslations } from 'next-intl'

type AccessOption = { label: string; description: string }

export const ACCESS_OPTIONS: Record<BoxAccess, AccessOption> = {
    none: { label: 'No access', description: "Doesn't see this Box" },
    use: { label: 'Can use', description: 'Chat with its coworkers and see their work' },
    manage: { label: 'Can manage', description: 'Also edit, move and delete coworkers' },
}

export function useAccessOptions(): Record<BoxAccess, AccessOption> {
    const t = useTranslations('dialogs.boxAccess.levels')
    return {
        none: { label: t('none.label'), description: t('none.description') },
        use: { label: t('use.label'), description: t('use.description') },
        manage: { label: t('manage.label'), description: t('manage.description') },
    }
}

// Width of an options list whose items carry a description, so the sentence fits under a narrow trigger.
export const OPTION_LIST_CLASS = 'w-72'

export function OptionWithDescription({ label, description }: { label: string; description: string }) {
    return (
        <span className="flex min-w-0 flex-col gap-0.5 py-0.5">
            <span>{label}</span>
            <span className="text-xs whitespace-normal text-muted-foreground">{description}</span>
        </span>
    )
}
