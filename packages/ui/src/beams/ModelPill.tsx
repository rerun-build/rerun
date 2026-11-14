import { cn } from '../cn'
import { BorderBeam } from '../BorderBeam'
import { MODEL_ICONS } from './model-icons'
import type { ModelLogoSlug } from './model-logos'

export type ModelPillItem = { name: string; logo: ModelLogoSlug }

export function ModelPill({ item, className }: { item: ModelPillItem; className?: string }) {
    const Logo = MODEL_ICONS[item.logo]
    return (
        <span className={cn('model-pill relative inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-2 whitespace-nowrap', className)}>
            <BorderBeam pattern="ring" tone="neutral" animated={false} />
            <Logo className="size-4 shrink-0" />
            <span className="text-charcoal-700 text-sm font-medium dark:text-neutral-100">{item.name}</span>
        </span>
    )
}
