import { useTranslations } from 'next-intl'
import { creatorKindLabel, type LibraryCreatorSummary } from '@/lib/templates/library-view'
import { cn } from '@/lib/utils'

// The place keeps its own direction: in one run with an Arabic or Hebrew kind, it would be cut by its start.
export function TemplateCreatorMeta({ creator, className }: { creator: Pick<LibraryCreatorSummary, 'kind' | 'location'>; className?: string }) {
    const tKind = useTranslations('templates.creatorKind')
    const kind = creatorKindLabel(creator.kind, tKind)
    return (
        <span className={cn('flex min-w-0', className)}>
            <span className="shrink-0 whitespace-pre">{creator.location ? `${kind} · ` : kind}</span>
            {creator.location && (
                <span dir="auto" className="truncate">
                    {creator.location}
                </span>
            )}
        </span>
    )
}
