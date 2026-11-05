import type { ReactNode } from 'react'
import { R_PATH } from '@/components/layout/Logo'
import { Icon } from '@/components/ui/icon'
import { LinkedPair } from '@/components/ui/linked-pair'
import { PUBLISHED_PAGE_MARKER } from '@/lib/published/marker'

const BADGE_URL = 'https://rerun.build/?utm_source=published&utm_medium=gate'

export type GateBrand = { name: string; iconUrl: string | null }

export function WorkspaceTile({ brand }: { brand: GateBrand }) {
    if (brand.iconUrl) return <Icon src={brand.iconUrl} size="lg" />
    return (
        <span aria-hidden className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-primary/5 text-lg font-semibold text-foreground">
            {brand.name.trim().charAt(0).toUpperCase() || 'R'}
        </span>
    )
}

// The tile a link that no longer exists shows: no workspace is left to name it, so Rerun does.
export function RerunTile() {
    return (
        <span aria-hidden className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-primary/5 text-foreground">
            <svg viewBox="0 0 512 512" className="size-6">
                <path d={R_PATH} fill="currentColor" />
            </svg>
        </span>
    )
}

function MadeWithRerun({ className }: { className?: string }) {
    return (
        <a
            href={BADGE_URL}
            target="_blank"
            rel="noopener"
            className={`flex items-center gap-1.5 whitespace-nowrap rounded-full border border-white/12 bg-[#0b0b0c] px-3.5 py-2.5 text-xs font-medium text-[#fafafa] shadow-[0_8px_24px_rgba(0,0,0,.24)] ${className ?? ''}`}
        >
            <svg viewBox="0 0 512 512" aria-hidden className="size-3.5">
                <path d={R_PATH} fill="currentColor" />
            </svg>
            Made with Rerun
        </a>
    )
}

// The lock a visitor meets: whose page it is on the left, what opens it on the right, the dots
// between them saying the two are being linked. No pixel of the page leaks here.
export function GateScreen({ brand, lock, mark, title, subtitle, children }: { brand: GateBrand; lock: ReactNode | null; mark?: ReactNode; title: string; subtitle: ReactNode; children?: ReactNode }) {
    const markerProps = { [PUBLISHED_PAGE_MARKER]: '' }
    return (
        <main {...markerProps} className="relative flex min-h-dvh w-full flex-col items-center justify-center bg-background px-5 pt-10 pb-24 text-foreground">
            <div className="flex w-full max-w-[360px] flex-col items-center gap-6 text-center">
                {lock ? <LinkedPair left={<WorkspaceTile brand={brand} />} right={lock} label={`${brand.name} page, locked`} /> : (mark ?? <WorkspaceTile brand={brand} />)}
                <div className="flex flex-col gap-1.5">
                    <h1 className="text-xl font-semibold tracking-tight text-balance break-words">{title}</h1>
                    <p className="text-sm text-balance break-words text-muted-foreground">{subtitle}</p>
                </div>
                {children && <div className="flex w-full flex-col gap-2.5">{children}</div>}
            </div>
            <MadeWithRerun className="absolute right-4 bottom-4 max-md:right-1/2 max-md:translate-x-1/2" />
        </main>
    )
}

export function GateMessage({ children }: { children: ReactNode }) {
    return <p className="-mt-1 text-left text-xs text-destructive">{children}</p>
}
