import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import type { CSSProperties } from 'react'

import { Orb } from '@rerun/ui/foreman'
import { AgentBuddy } from '@rerun/ui/iso-grid'

import { OgReadyMarker } from '@/components/og/OgReadyMarker'
import { BARE_PARAM, bareSideOf, PORTRAIT_SIZE, portraitOfSlug } from '@/lib/og/coworker-portrait'

// Rendering surface for the screenshot service: a coworker's portrait as a phone shows it beside a
// push, cropped to a circle. Opaque to the edge: a phone paints a transparent corner black or white.
export const metadata: Metadata = {
    title: 'Coworker portrait',
    robots: { index: false, follow: false },
}

const ORB_COLOR = '#4d34f7'
// A phone shows the portrait at some 40 points: the buddy drawn for that size, whose face is larger, then
// scaled up to fill the capture.
const BUDDY_SIZE = 36
const BUDDY_SCALE = (PORTRAIT_SIZE * 0.78) / BUDDY_SIZE
const ORB_SIZE = PORTRAIT_SIZE * 0.66
// Alone, it fills the capture: there is no circle to fit in.
const BARE_BUDDY_SCALE = PORTRAIT_SIZE / BUDDY_SIZE
const BARE_ORB_SIZE = PORTRAIT_SIZE * 0.84

// The portrait is one picture for both themes: the body keeps its light one's tone whatever the page's.
const BUDDY_BODY = { '--iso-buddy-mascot-body': '#4a4e5c' } as CSSProperties
// Alone on the dark card of an email, that tone would melt into it.
const BARE_BODY = { '--iso-buddy-mascot-body': '#8d93a6' } as CSSProperties

export default async function CoworkerPortraitPage({ params, searchParams }: { params: Promise<{ look: string }>; searchParams: Promise<{ [param: string]: string | undefined }> }) {
    const portrait = portraitOfSlug((await params).look)
    if (!portrait) notFound()

    const bare = bareSideOf((await searchParams)[BARE_PARAM])
    const color = portrait.kind === 'foreman' ? ORB_COLOR : portrait.look.color

    return (
        <main
            className="flex items-center justify-center overflow-hidden"
            style={{ ...(bare ? BARE_BODY : BUDDY_BODY), width: PORTRAIT_SIZE, height: PORTRAIT_SIZE, background: bare ? 'transparent' : `color-mix(in srgb, ${color}, white 82%)` }}
        >
            {/* The dev overlay renders in the corner of the viewport, so it lands inside the capture. */}
            <style>{`nextjs-portal{display:none}${bare ? 'html,body{background:transparent!important}' : ''}`}</style>
            {portrait.kind === 'foreman' ? (
                <Orb size={bare ? BARE_ORB_SIZE : ORB_SIZE} paused facing={bare ?? undefined} />
            ) : (
                <div style={{ transform: `scale(${bare ? BARE_BUDDY_SCALE : BUDDY_SCALE})` }}>
                    <AgentBuddy agentId="portrait" look={portrait.look} size={BUDDY_SIZE} animated={false} facing={bare ?? undefined} />
                </div>
            )}
            <OgReadyMarker />
        </main>
    )
}
