'use client'

import type { CountryCode } from 'libphonenumber-js/min'
import type { AppConnectionView, AppsOverview } from '@/app/api/_services/apps.service'
import { AccountsScreen, AccountsSkeleton, AppIcon, AppPageHeader, IntroScreen, SuccessScreen, connectHint } from '@/components/apps/PaidAppViews'
import { WHATSAPP_PRESENTATION, WhatsappConnectScreen, WhatsappLinkScreen, type WhatsappConnectInput, type WhatsappLinkMethod } from '@/components/apps/WhatsappProViews'
import { PanelDialogContent } from '@/components/dialogs/PanelDialogContent'
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { PanelSteps } from '@/components/ui/panel-steps'
import { useTranslations } from 'next-intl'
import type { LinkupLinkCode } from '@/lib/apps/linkup/client'

export type WhatsappProScreen =
    | { kind: 'accounts' }
    | { kind: 'connect'; reconnect: { id: string; label: string | null } | null }
    | { kind: 'link'; connectionId: string; method: WhatsappLinkMethod; phoneNumber: string; link: LinkupLinkCode | null; expired: boolean }
    | { kind: 'success'; label: string | null }

const SCREEN_DEPTH: Record<WhatsappProScreen['kind'], number> = { accounts: 0, connect: 1, link: 2, success: 3 }

export type WhatsappProDialogViewProps = {
    open: boolean
    onOpenChange: (open: boolean) => void
    overview: AppsOverview | null
    screen: WhatsappProScreen
    pending: string | null
    error: string | null
    defaultCountry: CountryCode
    defaultMethod: WhatsappLinkMethod
    onConnectStart: () => void
    onReconnect: (connection: AppConnectionView) => void
    onDisconnect: (connection: AppConnectionView) => void
    onAddSlot: () => void
    onBack: () => void
    onSubmitNumber: (input: WhatsappConnectInput) => void
    onNewCode: () => void
    onSwitchMethod: () => void
    onDone: () => void
}

// The number a reconnect links again, read back from its label: "Jane (+33612345678)" or the bare number.
function numberInLabel(label: string | null | undefined): string {
    return label?.match(/\+\d{7,15}/)?.[0] ?? ''
}

export function WhatsappProDialogView(props: WhatsappProDialogViewProps) {
    const t = useTranslations('dialogs.whatsappPro')
    const { open, onOpenChange, overview, screen, pending, error } = props
    const intro = screen.kind === 'accounts' && overview !== null && overview.connections.length === 0

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <PanelDialogContent className="sm:h-[min(42rem,88dvh)] sm:max-w-xl">
                {screen.kind === 'accounts' && !intro ? (
                    <DialogHeader className="flex-row items-center gap-3 border-b px-4 py-4 text-left">
                        <AppIcon slug="whatsapp" size="md" />
                        <div className="min-w-0 space-y-0.5">
                            <DialogTitle>WhatsApp Pro</DialogTitle>
                            <DialogDescription>{t('description')}</DialogDescription>
                        </div>
                    </DialogHeader>
                ) : (
                    <DialogHeader className="sr-only">
                        <DialogTitle>WhatsApp Pro</DialogTitle>
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
                                    <IntroScreen presentation={WHATSAPP_PRESENTATION} overview={overview} pending={pending} onConnectStart={props.onConnectStart} onAddSlot={props.onAddSlot} />
                                ) : (
                                    <AccountsScreen overview={overview} pending={pending} onConnectStart={props.onConnectStart} onReconnect={props.onReconnect} onDisconnect={props.onDisconnect} onAddSlot={props.onAddSlot} />
                                )}
                            </>
                        )}
                        {screen.kind === 'connect' && (
                            <>
                                <AppPageHeader slug="whatsapp" title={screen.reconnect ? t('connect.reconnectTitle') : t('connect.title')} hint={connectHint(overview, screen.reconnect?.label)} backLabel={t('connect.back')} onBack={props.onBack} />
                                <WhatsappConnectScreen
                                    defaultCountry={props.defaultCountry}
                                    defaultMethod={props.defaultMethod}
                                    initialPhone={numberInLabel(screen.reconnect?.label)}
                                    pending={pending === 'connect'}
                                    error={error}
                                    onSubmit={props.onSubmitNumber}
                                />
                            </>
                        )}
                        {screen.kind === 'link' && (
                            <>
                                <AppPageHeader slug="whatsapp" title={t('link.title')} hint={t('link.hint')} backLabel={t('link.cancel')} onBack={props.onBack} />
                                <WhatsappLinkScreen
                                    method={screen.method}
                                    phoneNumber={screen.phoneNumber}
                                    link={screen.link}
                                    expired={screen.expired}
                                    pending={pending === 'connect'}
                                    error={error}
                                    onNewCode={props.onNewCode}
                                    onSwitchMethod={props.onSwitchMethod}
                                />
                            </>
                        )}
                        {screen.kind === 'success' && <SuccessScreen slug="whatsapp" label={screen.label} onDone={props.onDone} />}
                    </PanelSteps>
                </div>
            </PanelDialogContent>
        </Dialog>
    )
}
