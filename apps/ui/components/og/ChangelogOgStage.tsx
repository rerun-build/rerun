import { MoldwrightWordmark } from '@/components/brand/MoldwrightWordmark'
import type { ChangelogOgEntry } from '@/lib/changelog/og'
import { OG_HEIGHT, OG_WIDTH } from '@/lib/og/size'

const formatDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })

function TimelineEntry({ entry, latest }: { entry: ChangelogOgEntry; latest: boolean }) {
    return (
        <article className="relative flex h-[118px] items-center gap-5 pl-9">
            <span className="absolute top-1/2 left-0 flex size-[11px] -translate-y-1/2 items-center justify-center rounded-full border border-neutral-700 bg-[#0a0a0a]">
                {latest ? <span className="size-full rounded-full bg-white" /> : null}
            </span>
            {entry.imageUrl ? (
                <div className="flex aspect-video h-full shrink-0 items-center justify-center overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={entry.imageUrl} alt="" className="size-full object-contain" />
                </div>
            ) : null}
            <div className="flex min-w-0 flex-col gap-1.5">
                <time className="text-sm leading-5 text-muted-foreground">{formatDate(entry.publishedAt)}</time>
                <h3 className={`line-clamp-2 text-[1.375rem] leading-7 font-semibold tracking-tight ${latest ? 'text-white' : 'text-neutral-300'}`}>{entry.title}</h3>
            </div>
        </article>
    )
}

export function ChangelogOgStage({ entries }: { entries: ChangelogOgEntry[] }) {
    return (
        <div className="dark relative overflow-hidden bg-[#0a0a0a] text-white" style={{ width: OG_WIDTH, height: OG_HEIGHT }}>
            <div className="absolute left-16 top-14 z-20">
                <MoldwrightWordmark />
            </div>

            <div className="absolute inset-y-0 left-16 z-20 flex max-w-[440px] flex-col justify-center gap-5">
                <h2 className="bg-radial-[at_35%_30%] from-white from-15% via-[#b4b4be] via-55% to-[#6f6f7d] to-95% bg-clip-text text-[4.5rem] font-semibold leading-[1.05] tracking-[-0.035em] text-transparent">
                    What&apos;s new
                </h2>
                <p className="text-2xl leading-snug text-muted-foreground">Every change we ship to Moldwright, newest first.</p>
            </div>

            <div className="absolute top-14 right-16 flex w-[556px] flex-col gap-9">
                <div className="absolute top-[59px] left-[5px] h-[640px] w-px bg-neutral-800" />
                {entries.map((entry, index) => (
                    <TimelineEntry key={entry.slug} entry={entry} latest={index === 0} />
                ))}
            </div>

            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-40 bg-linear-to-t from-[#0a0a0a] via-[#0a0a0a]/70 to-transparent" />
        </div>
    )
}
