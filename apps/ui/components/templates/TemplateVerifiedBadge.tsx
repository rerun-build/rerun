import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'

export function TemplateVerifiedBadge({ className }: { className?: string }) {
    const t = useTranslations('templates.creator')
    return (
        <svg viewBox="0 0 16 16" role="img" aria-label={t('verified')} className={cn('size-3.5 shrink-0 text-sky-500', className)}>
            <title>{t('verified')}</title>
            <circle cx="8" cy="8" r="8" fill="currentColor" />
            <path d="M4.75 8.25 6.9 10.4 11.25 5.9" fill="none" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    )
}
