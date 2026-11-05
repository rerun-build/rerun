import 'server-only'
import { readFile } from 'node:fs/promises'
import { ImageResponse } from 'next/og'
import { R_PATH } from '@rerun/ui/logo'

const WIDTH = 1200
const HEIGHT = 630
const BACKGROUND = '#0b0b0c'
const MAX_TITLE_LENGTH = 90

let fontsPromise: Promise<{ regular: Buffer; semibold: Buffer }> | null = null
function loadFonts() {
    fontsPromise ??= (async () => ({
        regular: await readFile(new URL('../../app/_fonts/Inter-Regular.ttf', import.meta.url)),
        semibold: await readFile(new URL('../../app/_fonts/Inter-SemiBold.ttf', import.meta.url)),
    }))()
    return fontsPromise
}

function truncate(text: string, max: number): string {
    return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`
}

// Satori draws no icon font: the lock is its own small drawing.
function Lock({ size, color }: { size: number; color: string }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="11" width="16" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
    )
}

function WorkspaceTile({ name, iconUrl }: { name: string; iconUrl: string | null }) {
    if (iconUrl) return <img src={iconUrl} width={40} height={40} style={{ borderRadius: 10, objectFit: 'cover' }} alt="" />
    return (
        <div style={{ display: 'flex', width: 40, height: 40, borderRadius: 10, backgroundColor: '#fafafa', color: BACKGROUND, alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 600 }}>
            {name.trim().charAt(0).toUpperCase() || 'R'}
        </div>
    )
}

export type PublishedOgInput = {
    locked: boolean
    title: string
    workspaceName: string
    workspaceIconUrl: string | null
    coworkerName: string | null
    thumbnailDataUrl: string | null
}

// The 1200×630 card a crawler fetches for a published link. A crawler never passes a gate, so a link
// that is not public only ever gets the locked card: no title, no capture, nothing a forwarded link
// would leak.
export async function publishedOgImage(input: PublishedOgInput): Promise<ImageResponse> {
    const fonts = await loadFonts()
    const title = input.locked ? 'Protected page' : truncate(input.title, MAX_TITLE_LENGTH)

    return new ImageResponse(
        (
            <div style={{ display: 'flex', width: '100%', height: '100%', backgroundColor: BACKGROUND, color: '#fafafa', fontFamily: 'Inter', position: 'relative' }}>
                <div style={{ position: 'absolute', inset: 0, display: 'flex', backgroundImage: 'radial-gradient(60% 80% at 85% 20%, rgba(99,102,241,0.35), rgba(11,11,12,0) 70%)' }} />
                <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', width: '58%', padding: 66 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 26, color: 'rgba(250,250,250,0.6)' }}>
                        <WorkspaceTile name={input.workspaceName} iconUrl={input.workspaceIconUrl} />
                        {truncate(input.workspaceName, 32)}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                        {input.locked && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, alignSelf: 'flex-start', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.1)', padding: '8px 20px', fontSize: 23, color: 'rgba(250,250,250,0.8)' }}>
                                <Lock size={24} color="rgba(250,250,250,0.8)" />
                                Protected
                            </div>
                        )}
                        <div style={{ display: 'flex', fontSize: 62, lineHeight: 1.05, fontWeight: 600, letterSpacing: -1.5 }}>{title}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 24, color: 'rgba(250,250,250,0.6)' }}>
                        <svg width={26} height={26} viewBox="0 0 512 512">
                            <path d={R_PATH} fill="#fafafa" />
                        </svg>
                        rerun.site
                    </div>
                </div>
                <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', paddingRight: 60, position: 'relative' }}>
                    {input.locked || !input.thumbnailDataUrl ? (
                        <div style={{ display: 'flex', width: '80%', height: 380, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
                            {input.locked ? (
                                <Lock size={84} color="rgba(250,250,250,0.4)" />
                            ) : (
                                <svg width={84} height={84} viewBox="0 0 512 512">
                                    <path d={R_PATH} fill="rgba(250,250,250,0.3)" />
                                </svg>
                            )}
                        </div>
                    ) : (
                        <div style={{ display: 'flex', width: '100%', transform: 'rotate(-4deg)', borderRadius: 14, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 36px 96px rgba(0,0,0,0.5)' }}>
                            <img src={input.thumbnailDataUrl} width={440} height={275} style={{ objectFit: 'cover', objectPosition: 'top' }} alt="" />
                        </div>
                    )}
                    {!input.locked && input.coworkerName && (
                        <div style={{ position: 'absolute', bottom: 60, left: 0, display: 'flex', fontSize: 22, color: 'rgba(250,250,250,0.6)' }}>by {truncate(input.coworkerName, 28)}</div>
                    )}
                </div>
            </div>
        ),
        {
            width: WIDTH,
            height: HEIGHT,
            fonts: [
                { name: 'Inter', data: fonts.regular, weight: 400, style: 'normal' },
                { name: 'Inter', data: fonts.semibold, weight: 600, style: 'normal' },
            ],
        },
    )
}
