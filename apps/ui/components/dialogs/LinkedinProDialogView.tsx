'use client'

import type { AppConnectionView, AppsOverview } from '@/app/api/_services/apps.service'
import { CheckpointScreen, ConnectScreen, LINKEDIN_PRESENTATION, type ApprovalWait, type LinkedinCredentials } from '@/components/apps/LinkedinProViews'
import { AccountsScreen, AccountsSkeleton, AppIcon, AppPageHeader, IntroScreen, SuccessScreen, connectHint } from '@/components/apps/PaidAppViews'
import { PanelDialogContent } from '@/components/dialogs/PanelDialogContent'
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { PanelSteps } from '@/components/ui/panel-steps'
import { useTranslations } from 'next-intl'

export type LinkedinProScreen =
    | { kind: 'accounts' }
    | { kind: 'connect'; reconnect: { id: string; label: string | null } | null }
    | { kind: 'checkpoint'; connectionId: string; checkpointType: string; sentTo: string | null }
    | { kind: 'success'; label: string | null }

const SCREEN_DEPTH: Record<LinkedinProScreen['kind'], number> = { accounts: 0, connect: 1, checkpoint: 2, success: 3 }

export type LinkedinProDialogViewProps = {
    open: boolean
    onOpenChange: (open: boolean) => void
    overview: AppsOverview | null
    screen: LinkedinProScreen
    pending: string | null
    error: string | null
    defaultCountry: string
    approvalWait?: ApprovalWait | null
    // For the lab: the connect screen opened on the cookie.
    initialSignIn?: 'password' | 'cookie'
    onConnectStart: () => void
    onReconnect: (connection: AppConnectionView) => void
    onDisconnect: (connection: AppConnectionView) => void
    onAddSlot: () => void
    onBack: () => void
    onSubmitCredentials: (credentials: LinkedinCredentials) => void
    onSubmitCode: (code?: string) => void
    onResend: () => void
    onDone: () => void
}

export function LinkedinProDialogView(props: LinkedinProDialogViewProps) {
    const t = useTranslations('dialogs.linkedinPro')
    const { open, onOpenChange, overview, screen, pending, error } = props
    const intro = screen.kind === 'accounts' && overview !== null && overview.connections.length === 0

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <PanelDialogContent className="sm:h-[min(42rem,88dvh)] sm:max-w-xl">
                {screen.kind === 'accounts' && !intro ? (
                    <DialogHeader className="flex-row items-center gap-3 border-b px-4 py-4 text-left">
                        <AppIcon slug="linkedin" size="md" />
                        <div className="min-w-0 space-y-0.5">
                            <DialogTitle>LinkedIn Pro</DialogTitle>
                            <DialogDescription>{t('description')}</DialogDescription>
                        </div>
                    </DialogHeader>
                ) : (
                    <DialogHeader className="sr-only">
                        <DialogTitle>LinkedIn Pro</DialogTitle>
                        <DialogDescription>{t('connectDescription')}</DialogDescription>
                    </DialogHeader>
                )}

                <div className="flex min-h-0 flex-1 flex-col">
                    <PanelSteps stepKey={screen.kind} depth={SCREEN_DEPTH[screen.kind]}>
                        {screen.kind === 'accounts' && (
                            <>
                                {error && <p className="px-4 pt-3 text-[11px] text-destructive">{error}</p>}
                                {!overview ? (
                                    <AccountsSkeleton />
                                ) : intro ? (
                                    <IntroScreen presentation={LINKEDIN_PRESENTATION} overview={overview} pending={pending} onConnectStart={props.onConnectStart} onAddSlot={props.onAddSlot} />
                                ) : (
                                    <AccountsScreen overview={overview} pending={pending} onConnectStart={props.onConnectStart} onReconnect={props.onReconnect} onDisconnect={props.onDisconnect} onAddSlot={props.onAddSlot} />
                                )}
                            </>
                        )}
                        {screen.kind === 'connect' && (
                            <>
                                <AppPageHeader slug="linkedin" title={screen.reconnect ? t('connect.reconnectTitle') : t('connect.title')} hint={connectHint(overview, screen.reconnect?.label)} backLabel={t('connect.back')} onBack={props.onBack} />
                                <ConnectScreen defaultCountry={props.defaultCountry} initialMethod={props.initialSignIn} pending={pending === 'connect'} error={error} onSubmit={props.onSubmitCredentials} />
                            </>
                        )}
                        {screen.kind === 'checkpoint' && (
                            <>
                                <AppPageHeader slug="linkedin" title={t('checkpoint.title')} hint={t('checkpoint.hint')} backLabel={t('checkpoint.cancel')} onBack={props.onBack} />
                                <CheckpointScreen
                                    checkpointType={screen.checkpointType}
                                    sentTo={screen.sentTo}
                                    pending={pending === 'checkpoint'}
                                    error={error}
                                    waiting={props.approvalWait}
                                    onSubmit={props.onSubmitCode}
                                    onResend={props.onResend}
                                />
                            </>
                        )}
                        {screen.kind === 'success' && <SuccessScreen slug="linkedin" label={screen.label} onDone={props.onDone} />}
                    </PanelSteps>
                </div>
            </PanelDialogContent>
        </Dialog>
    )
}
