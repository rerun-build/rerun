'use client'

import { ChatComposer } from '@/components/chat/ChatComposer'
import { MessageView } from '@/components/chat/MessageView'
import { ATLAS, CAST_LOOKS, NOVA, type CastMember } from '@/components/onboarding/panels/cast'
import { ForemanAccent } from '@/components/onboarding/panels/ForemanAccent'
import { PanelStage, PanelWindow } from '@/components/onboarding/panels/PanelStage'
import { AgentBuddy, BuddyLooksProvider } from '@rerun/ui/iso-grid'
import type { UIMessage } from 'ai'
import { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'
import { routineMessages, taskMessages } from './chat-demo'

const send = async () => {}

// The chat's own title bar needs a session: this one is drawn with its markup.
function ChatWindow({ coworker, conversation, messages, composer }: { coworker: CastMember; conversation: string; messages: UIMessage[]; composer?: ReactNode }) {
    return (
        <PanelWindow>
            <div className="flex min-h-12 shrink-0 items-center gap-1 border-b border-border px-2">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md">
                    <AgentBuddy agentId={coworker.id} look={coworker.look} size={28} facing="right" />
                </span>
                <span className="flex h-7 items-center rounded-md bg-accent px-2 text-xs font-medium">{conversation}</span>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-4">
                <BuddyLooksProvider looks={CAST_LOOKS}>
                    {messages.map((message, index) => (
                        <MessageView key={message.id} message={message} agentId={coworker.id} settled isLastAssistant={index === messages.length - 1} />
                    ))}
                </BuddyLooksProvider>
            </div>
            {composer && <div className="shrink-0 border-t border-border p-3">{composer}</div>}
        </PanelWindow>
    )
}

// A coworker's chat: the job, the steps it took in the user's own apps, the table it brought back.
export function TaskSlide() {
    const t = useTranslations('onboarding.showcase')
    return (
        <PanelStage width={560} height={660} maxScale={0.74} accent={<ForemanAccent facing="right" delay={0.8} className="left-8" />}>
            <ChatWindow
                coworker={ATLAS}
                conversation={t('task.conversation')}
                messages={taskMessages(t)}
                composer={<ChatComposer uid="onboarding-showcase" active={false} status="ready" busy={false} uploadTarget={{ kind: 'agent', agentId: ATLAS.id }} onSend={send} voiceEnabled={false} attachmentsEnabled={false} placeholder={t('task.placeholder', { name: ATLAS.name })} />}
            />
        </PanelStage>
    )
}

// What came back on its own: a routine fired while nobody was there, and its result.
export function DoneSlide() {
    const t = useTranslations('onboarding.showcase')
    return (
        <PanelStage width={560} height={540} maxScale={0.82} accent={<ForemanAccent facing="left" delay={0.4} className="right-12" />}>
            <ChatWindow coworker={NOVA} conversation={t('done.routine')} messages={routineMessages(t)} />
        </PanelStage>
    )
}
