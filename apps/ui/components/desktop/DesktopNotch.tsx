'use client'

import type { DesktopApp } from '@rerun/contracts'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { DialogClose } from '@/components/ui/dialog'
import { TooltipDisabledReason, TooltipLabeled } from '@/components/ui/tooltip'
import { ClipboardPasteIcon, FolderIcon, GlobeIcon, TerminalIcon, XIcon } from '@/lib/icons'

type DesktopNotchProps = {
    // False when the screen has a dock of its own: only what it cannot do stays here.
    launchers: boolean
    // The notch opened the agent's browser, so the same button closes it again.
    browsing: boolean
    // Why the notch cannot open the browser, when something else already holds it.
    browserLockedReason?: string
    disabled?: boolean
    takeoverReason?: string
    onOpenApp: (app: DesktopApp) => void
    onToggleBrowser: () => void
    onPaste: () => void
    onDone?: () => void
}

const SHOULDER = 'absolute top-0 size-3'

// Everything the app adds to an agent's screen, hung from the top edge of its dialog so nothing
// else covers the screen. Render it inside a positioned box, within the dialog it closes.
export function DesktopNotch({ launchers, browsing, browserLockedReason, disabled, takeoverReason, onOpenApp, onToggleBrowser, onPaste, onDone }: DesktopNotchProps) {
    const t = useTranslations('desktop.notch')
    const browserLabel = browsing ? t('closeBrowser') : t('browser')

    return (
        <div className="absolute top-0 left-1/2 z-10 flex max-w-[calc(100%-3rem)] -translate-x-1/2 items-center gap-1 rounded-b-xl bg-popover px-1.5 pt-0.5 pb-1.5 text-popover-foreground">
            <span aria-hidden className={`${SHOULDER} right-full bg-[radial-gradient(circle_at_0_100%,transparent_calc(0.75rem-0.5px),var(--popover)_0.75rem)]`} />
            <span aria-hidden className={`${SHOULDER} left-full bg-[radial-gradient(circle_at_100%_100%,transparent_calc(0.75rem-0.5px),var(--popover)_0.75rem)]`} />
            {takeoverReason && <p className="max-w-64 truncate px-1.5 text-xs font-medium">{takeoverReason}</p>}
            {launchers && (
                <>
                    <TooltipDisabledReason reason={browserLockedReason} side="bottom">
                        <TooltipLabeled label={browserLabel} side="bottom">
                            <Button aria-label={browserLabel} size="icon-sm" variant={browsing ? 'secondary' : 'ghost'} disabled={disabled || !!browserLockedReason} onClick={onToggleBrowser}>
                                <GlobeIcon className="size-4" />
                            </Button>
                        </TooltipLabeled>
                    </TooltipDisabledReason>
                    <TooltipLabeled label={t('files')} side="bottom">
                        <Button aria-label={t('files')} size="icon-sm" variant="ghost" disabled={disabled} onClick={() => onOpenApp('files')}>
                            <FolderIcon className="size-4" />
                        </Button>
                    </TooltipLabeled>
                    <TooltipLabeled label={t('terminal')} side="bottom">
                        <Button aria-label={t('terminal')} size="icon-sm" variant="ghost" disabled={disabled} onClick={() => onOpenApp('terminal')}>
                            <TerminalIcon className="size-4" />
                        </Button>
                    </TooltipLabeled>
                </>
            )}
            <TooltipLabeled label={t('paste')} side="bottom">
                <Button aria-label={t('paste')} size="icon-sm" variant="ghost" disabled={disabled} onClick={onPaste}>
                    <ClipboardPasteIcon className="size-4" />
                </Button>
            </TooltipLabeled>
            {onDone && (
                <Button size="sm" disabled={disabled} onClick={onDone}>
                    {t('done')}
                </Button>
            )}
            <DialogClose asChild>
                <Button aria-label={t('close')} size="icon-sm" variant="ghost">
                    <XIcon className="size-4" />
                </Button>
            </DialogClose>
        </div>
    )
}
