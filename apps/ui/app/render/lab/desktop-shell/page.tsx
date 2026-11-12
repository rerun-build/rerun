'use client'

import { DESKTOP_SHELL_PREVIEW_PARAM } from '@/lib/desktop-shell/preview'
import type { DesktopShellPlatform } from '@rerun/contracts'
import { SegmentedControl, SegmentedControlItem } from '@rerun/ui/primitives'
import { ThemeToggle } from '@rerun/ui/theme'
import { useState } from 'react'

// The desktop app's window chrome without Electron: the app framed as each platform draws the
// window, its pages rendered as the desktop app gets them (the strip, the insets). The native
// buttons are drawn here the way the system draws them over the strip. The theme toggle switches
// the framed app too: they share the page's preference.

const PLATFORMS: { value: DesktopShellPlatform; label: string }[] = [
    { value: 'mac', label: 'macOS' },
    { value: 'win', label: 'Windows' },
    { value: 'linux', label: 'Linux' },
]

const PATHS = ['/', '/auth']

const SIZES = [
    { value: '1280x800', label: '1280 × 800' },
    { value: '820x640', label: '820 × 640' },
    { value: '420x720', label: '420 × 720' },
]

function MacButtons() {
    return (
        <div className="pointer-events-none absolute top-2 left-3 flex gap-2">
            {['#ff5f57', '#febc2e', '#28c840'].map((color) => (
                <span key={color} className="size-3 rounded-full shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.2)]" style={{ background: color }} />
            ))}
        </div>
    )
}

function CaptionButtons() {
    return (
        <div className="pointer-events-none absolute top-0 right-0 flex h-8 text-foreground">
            {['M0 5h10', 'M.5.5h9v9h-9z', 'M0 0l10 10M10 0L0 10'].map((path) => (
                <span key={path} className="grid h-8 w-[46px] place-items-center">
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
                        <path d={path} />
                    </svg>
                </span>
            ))}
        </div>
    )
}

export default function DesktopShellLab() {
    const [platform, setPlatform] = useState<DesktopShellPlatform>('mac')
    const [path, setPath] = useState('/')
    const [size, setSize] = useState('1280x800')
    const [width, height] = size.split('x').map(Number)
    const separator = path.includes('?') ? '&' : '?'

    return (
        <div className="flex min-h-dvh flex-col items-center gap-6 bg-muted/40 p-6">
            <div className="flex flex-wrap items-center justify-center gap-3">
                <SegmentedControl value={platform} onValueChange={(value) => setPlatform(value as DesktopShellPlatform)}>
                    {PLATFORMS.map((item) => (
                        <SegmentedControlItem key={item.value} value={item.value}>
                            {item.label}
                        </SegmentedControlItem>
                    ))}
                </SegmentedControl>
                <SegmentedControl value={path} onValueChange={setPath}>
                    {PATHS.map((item) => (
                        <SegmentedControlItem key={item} value={item}>
                            {item}
                        </SegmentedControlItem>
                    ))}
                </SegmentedControl>
                <SegmentedControl value={size} onValueChange={setSize}>
                    {SIZES.map((item) => (
                        <SegmentedControlItem key={item.value} value={item.value}>
                            {item.label}
                        </SegmentedControlItem>
                    ))}
                </SegmentedControl>
                <ThemeToggle />
            </div>
            <div className="max-w-full overflow-auto">
                <div className={platform === 'mac' ? 'relative overflow-hidden rounded-[10px] shadow-2xl ring-1 ring-black/20' : 'relative overflow-hidden rounded-md shadow-2xl ring-1 ring-black/30'} style={{ width, height }}>
                    <iframe key={`${platform}-${path}`} title="Rerun" src={`${path}${separator}${DESKTOP_SHELL_PREVIEW_PARAM}=${platform}`} className="size-full border-0" />
                    {platform === 'mac' ? <MacButtons /> : <CaptionButtons />}
                </div>
            </div>
        </div>
    )
}
