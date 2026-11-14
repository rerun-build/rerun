import { APP_CATEGORIES, LANDING_CATEGORIES, kitCategoryPath, type KitCategory } from './catalogue'

export function KitIndex({ here, landingBase, appBase }: { here: 'landing' | 'app'; landingBase: string; appBase: string }) {
    const hrefOf = (category: KitCategory) => {
        const base = category.host === here ? '' : category.host === 'landing' ? landingBase : appBase
        return `${base}${kitCategoryPath(category)}`
    }

    return (
        <div className="flex flex-col gap-10">
            <KitIndexGroup
                title="Shared bricks"
                description="Everything in the @rerun/ui package: the pieces the marketing site and the app both render, from the same source."
                offset={0}
                categories={LANDING_CATEGORIES}
                hrefOf={hrefOf}
                external={here !== 'landing'}
            />
            <KitIndexGroup
                title="The app"
                description="The surfaces that only exist inside the product. They live in apps/ui and cannot be imported by the marketing site, so they are served from the app itself."
                offset={LANDING_CATEGORIES.length}
                categories={APP_CATEGORIES}
                hrefOf={hrefOf}
                external={here !== 'app'}
            />
        </div>
    )
}

function KitIndexGroup({
    title,
    description,
    offset,
    categories,
    hrefOf,
    external,
}: {
    title: string
    description: string
    offset: number
    categories: KitCategory[]
    hrefOf: (category: KitCategory) => string
    external: boolean
}) {
    return (
        <section className="flex flex-col gap-4">
            <div className="max-w-2xl">
                <h2 className="text-xl font-medium tracking-tight text-foreground">{title}</h2>
                <p className="mt-2 text-sm text-foreground/50">{description}</p>
            </div>
            <div className="overflow-hidden rounded-xl border border-border">
                {categories.map((category, index) => (
                    <a
                        key={category.slug}
                        href={hrefOf(category)}
                        className="flex flex-col gap-1 border-b border-border px-4 py-3.5 transition-colors last:border-b-0 hover:bg-muted/40 sm:flex-row sm:items-baseline sm:gap-4"
                    >
                        <span className="shrink-0 font-mono text-xs text-foreground/25">{String(offset + index + 1).padStart(2, '0')}</span>
                        <span className="w-56 shrink-0 text-sm font-medium text-foreground">{category.label}</span>
                        <span className="text-sm text-foreground/50">{category.blurb}</span>
                        {external && <span className="shrink-0 font-mono text-[11px] text-foreground/25 sm:ml-auto">{category.host === 'app' ? 'app' : 'rerun.build'}</span>}
                    </a>
                ))}
            </div>
        </section>
    )
}
