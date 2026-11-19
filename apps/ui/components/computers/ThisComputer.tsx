'use client'

import { remoteHandleFromName, type DesktopRemoteComputerState, type DesktopRemoteLink } from '@rerun/contracts'
import { BorderBeam } from '@rerun/ui'
import { PanelRow, Skeleton, Stripes } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'
import { useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { linkThisComputerAction } from '@/app/api/_actions/remote-computers.actions'
import { useSession } from '@/supabase/session/SessionProvider'
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog'
import { DialogHeaderBar } from '@/components/dialogs/DialogHeaderBar'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useErrorText, type Refusal } from '@/hooks/useErrorText'
import type { ErrorCode } from '@/lib/i18n/action-error'
import type { ComputerStatus } from '@/lib/computers/types'
import { desktopShell } from '@/lib/desktop-shell/client'
import { CheckIcon, FolderIcon, MonitorIcon, PlusIcon } from '@/lib/icons'

import { ComputerHandle, ComputerNote, ComputerStatusBadge, OsTile } from './ComputerBits'

const BRAND_STRIPES = 'color-mix(in oklab, var(--color-brand) 6%, transparent)'

type RemoteComputerShell = NonNullable<NonNullable<ReturnType<typeof desktopShell>>['remoteComputer']>

function remoteComputerShell(): RemoteComputerShell | null {
    return desktopShell('remoteComputer')?.remoteComputer ?? null
}

// The desktop app refuses in plain English across IPC, which Electron wraps as
// "Error invoking remote method '…': Error: <message>". The ones it is known to send get a code.
const DESKTOP_REFUSALS: Record<string, ErrorCode> = { 'No server': 'desktopNoServer', 'Invalid token': 'desktopInvalidToken' }

function desktopRefusal(err: unknown): Refusal {
    const message = err instanceof Error ? err.message : String(err)
    const known = Object.keys(DESKTOP_REFUSALS).find(text => message === text || message.endsWith(`Error: ${text}`))
    return { error: message, code: known ? DESKTOP_REFUSALS[known] : undefined }
}

// This very computer, as the desktop app sees it, followed as it changes.
function useThisComputer(): DesktopRemoteComputerState | null {
    const [state, setState] = useState<DesktopRemoteComputerState | null>(null)
    useEffect(() => {
        const shell = remoteComputerShell()
        if (!shell) return
        void shell.getState().then(setState)
        return shell.onState(setState)
    }, [])
    return state
}

function statusOf(link: DesktopRemoteLink, state: DesktopRemoteComputerState): ComputerStatus {
    if (link.status !== 'online') return 'offline'
    if (state.paused) return 'paused'
    return state.runningJobs > 0 ? 'busy' : 'online'
}

// The striped row of the Computers dialog that offers to link the computer the app runs on. It says
// whether this workspace already has it, for the list to leave it out.
export function ThisComputerLinkRow({ onLinkedChange, onLinked }: { onLinkedChange: (linked: boolean) => void; onLinked: () => Promise<void> | void }) {
    const t = useTranslations('computers.thisComputer')
    const state = useThisComputer()
    const { workspace } = useSession()
    const [linking, setLinking] = useState(false)
    const linked = state && workspace ? state.links.some(link => link.workspaceId === workspace.id && link.status !== 'revoked') : null

    useEffect(() => {
        if (linked !== null) onLinkedChange(linked)
    }, [linked, onLinkedChange])

    if (!state || linked !== false) return null
    return (
        <div className="relative overflow-hidden rounded-md">
            <Stripes fade="right" color={BRAND_STRIPES} />
            <PanelRow
                className="relative"
                leading={<OsTile os={state.machine.os} />}
                title={state.machine.suggestedName}
                description={t('offer')}
                actions={
                    <Button size="xs" onClick={() => setLinking(true)}>
                        <PlusIcon className="size-3" />
                        {t('link')}
                    </Button>
                }
            />
            <BorderBeam pattern="arcs" tone="brand" />
            <LinkComputerDialog
                open={linking}
                onOpenChange={setLinking}
                state={state}
                onLinked={onLinked}
            />
        </div>
    )
}

// The Desktop tab of the account dialog, in the desktop app only: what this computer lends to the
// workspace, above the app's own settings.
export function ThisComputerSection() {
    const t = useTranslations('computers.thisComputer')
    const state = useThisComputer()
    const { workspace } = useSession()
    const [linking, setLinking] = useState(false)
    const [unlinking, setUnlinking] = useState<DesktopRemoteLink | null>(null)
    const [busy, setBusy] = useState(false)
    const errorText = useErrorText()
    const shell = remoteComputerShell()
    if (!shell) return null
    if (!state || !workspace) return <Skeleton className="h-16 w-full" />

    // A link of this computer to the workspace open in the app: one per workspace at most.
    const here = state.links.find(link => link.workspaceId === workspace.id && link.status !== 'revoked') ?? null
    const elsewhere = state.links.filter(link => link !== here && link.status !== 'revoked')

    const unlink = async () => {
        if (!unlinking) return
        setBusy(true)
        try {
            await shell.unlink(unlinking.computerId)
            setUnlinking(null)
        } catch (err) {
            toast.error(errorText(desktopRefusal(err)))
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className="space-y-6">
            <section className="space-y-2">
                <h3 className="text-sm font-medium text-muted-foreground">{t('heading')}</h3>
                <div className="space-y-1.5">
                    {here ? (
                        <LinkRow link={here} state={state} />
                    ) : (
                        <PanelRow
                            leading={<OsTile os={state.machine.os} />}
                            title={state.machine.suggestedName}
                            description={t('offerLong')}
                            actions={
                                <Button size="sm" onClick={() => setLinking(true)}>
                                    <PlusIcon className="size-3.5" />
                                    {t('link')}
                                </Button>
                            }
                        />
                    )}
                    {elsewhere.map(link => (
                        <LinkRow key={link.computerId} link={link} state={state} />
                    ))}
                </div>
            </section>

            {!state.secureStorage && state.links.length > 0 && <ComputerNote>{t('noKeychain')}</ComputerNote>}

            {state.links.length > 0 && (
                <>
                    <Field orientation="row" label={t('pause')} helperText={t('pauseHint')} htmlFor="computer-pause">
                        <Switch id="computer-pause" checked={state.paused} onCheckedChange={paused => void shell.setPaused(paused)} />
                    </Field>
                    <Field orientation="row" label={t('folder')} helperText={state.workDir} htmlFor="computer-folder">
                        <Button id="computer-folder" size="sm" variant="outline" onClick={() => void shell.chooseWorkDir()}>
                            <FolderIcon className="size-3.5" />
                            {t('changeFolder')}
                        </Button>
                    </Field>
                    {here && (
                        <div>
                            <Button size="sm" variant="outline" className="text-destructive" onClick={() => setUnlinking(here)}>
                                {t('unlink')}
                            </Button>
                        </div>
                    )}
                </>
            )}

            <LinkComputerDialog open={linking} onOpenChange={setLinking} state={state} onLinked={() => {}} />
            <ConfirmDialog
                open={unlinking !== null}
                onOpenChange={open => !open && setUnlinking(null)}
                title={t('unlinkTitle')}
                description={t('unlinkBody', { workspace: unlinking?.workspaceName ?? '' })}
                confirmLabel={t('unlinkConfirm')}
                pending={busy}
                onConfirm={() => void unlink()}
            />
        </div>
    )
}

function LinkRow({ link, state }: { link: DesktopRemoteLink; state: DesktopRemoteComputerState }) {
    const t = useTranslations('computers.thisComputer')
    return (
        <PanelRow
            leading={<OsTile os={state.machine.os} />}
            title={link.name}
            description={
                <>
                    <ComputerHandle handle={link.handle} /> {t('inWorkspace', { workspace: link.workspaceName })}
                </>
            }
            actions={link.status === 'connecting' ? <Skeleton className="h-4 w-14 rounded-full" /> : <ComputerStatusBadge status={statusOf(link, state)} jobs={state.runningJobs} />}
        />
    )
}

// The short form opened by "Link". The name comes first: its handle is what people type in the chat.
function LinkComputerDialog({ open, onOpenChange, state, onLinked }: { open: boolean; onOpenChange: (open: boolean) => void; state: DesktopRemoteComputerState; onLinked: () => Promise<void> | void }) {
    const t = useTranslations('computers.linkDialog')
    const errorText = useErrorText()
    const [name, setName] = useState(state.machine.suggestedName)
    const [pending, setPending] = useState(false)
    const handle = remoteHandleFromName(name) || 'computer'

    const submit = async () => {
        const shell = desktopShell('remoteComputer')
        if (!shell?.remoteComputer) return
        setPending(true)
        try {
            const res = await linkThisComputerAction({ name, os: state.machine.os, arch: state.machine.arch, hostname: state.machine.hostname, appVersion: shell.version })
            if (!res.ok) return void toast.error(errorText(res))
            await shell.remoteComputer.link({ token: res.token, computer: res.computer, workspaceId: res.workspace.id, workspaceName: res.workspace.name })
            toast.success(t('linked', { handle: res.computer.handle }))
            onOpenChange(false)
            await onLinked()
        } catch (err) {
            toast.error(errorText(desktopRefusal(err)))
        } finally {
            setPending(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeaderBar icon={MonitorIcon} title={t('title')} description={t('description')} />
                <form
                    className="space-y-4 p-4"
                    onSubmit={event => {
                        event.preventDefault()
                        void submit()
                    }}
                >
                    <Input id="link-computer-name" label={t('name')} value={name} maxLength={100} onChange={event => setName(event.target.value)} autoFocus />
                    <p className="-mt-2 text-xs text-muted-foreground">{t.rich('handle', { handle: () => <ComputerHandle handle={handle} /> })}</p>
                    <ul className="space-y-1.5 text-xs text-muted-foreground">
                        <Bullet>{t('everyone')}</Bullet>
                        <Bullet>{t('approval')}</Bullet>
                        <Bullet>{t('pauseAnyTime')}</Bullet>
                    </ul>
                </form>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        {t('cancel')}
                    </Button>
                    <Button disabled={pending || !name.trim()} onClick={() => void submit()}>
                        {t('link')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

function Bullet({ children }: { children: ReactNode }) {
    return (
        <li className="flex items-start gap-2">
            <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            <span>{children}</span>
        </li>
    )
}
