import { TemplateDetailSection } from '@/components/templates/TemplateDetailSection'
import { ChevronRightIcon } from '@/lib/icons'
import type { UseCase } from '@/lib/templates/use-cases'

export function TemplateDetailUseCases({ title, useCases, onSelect }: { title: string; useCases: UseCase[]; onSelect: (useCase: UseCase) => void }) {
    if (useCases.length === 0) return null
    return (
        <TemplateDetailSection title={title} count={useCases.length}>
            <ul className="-mx-2 space-y-1">
                {useCases.map(useCase => (
                    <li key={useCase.id}>
                        <button
                            type="button"
                            onClick={() => onSelect(useCase)}
                            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start text-[13px] transition-colors outline-none hover:bg-foreground/[0.05] focus-visible:ring-3 focus-visible:ring-ring/50"
                        >
                            <span dir="auto" className="min-w-0 flex-1 truncate rtl:text-right">{useCase.name}</span>
                            <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground/60" />
                        </button>
                    </li>
                ))}
            </ul>
        </TemplateDetailSection>
    )
}
