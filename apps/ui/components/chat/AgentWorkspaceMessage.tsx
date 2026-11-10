'use client'

import { MessageResponse, type MessageResponseProps } from '@/components/ai-elements/message'
import { LINK_TOKEN_CLASS, MENTION_TOKEN_CLASSES } from '@/components/chat/composer-token-styles'
import { COMPOSER_LINK_TAG, COMPOSER_MENTION_KIND_ATTRIBUTE, COMPOSER_MENTION_TAG, type ComposerMention, remarkMentions, remarkShortLinks } from '@/lib/chat/composer-links'
import { LinkIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { AGENT_WORKSPACE_FILE_PATH_ATTRIBUTE, AGENT_WORKSPACE_FILE_TAG, remarkAgentWorkspaceLinks } from '@/lib/files/workspace-link'
import { useBoardStore } from '@/stores/board.store'
import { useTranslations } from 'next-intl'
import { createContext, type ReactNode, useContext, useMemo } from 'react'
import { defaultRemarkPlugins, type Components } from 'streamdown'

const AgentWorkspaceContext = createContext<string | null>(null)

type WorkspaceFileLinkProps = {
    children?: ReactNode
    className?: string
    node?: unknown
    path?: string
}

function WorkspaceFileLink({ children, className, path }: WorkspaceFileLinkProps) {
    const t = useTranslations('chat.message')
    const agentId = useContext(AgentWorkspaceContext)
    const openAgentFile = useBoardStore(state => state.openAgentFile)

    if (!agentId || !path) return <span className={className}>{children}</span>

    return (
        <button
            type="button"
            className={cn('wrap-anywhere appearance-none text-left font-medium text-primary underline', className)}
            data-streamdown="link"
            title={t('openFile', { path })}
            onClick={() => openAgentFile(agentId, path)}
        >
            {children}
        </button>
    )
}

type MentionTokenProps = {
    children?: ReactNode
    node?: unknown
    kind?: string
}

function MentionToken({ children, kind }: MentionTokenProps) {
    return <span className={cn('font-medium', kind === 'agent' || kind === 'skill' ? MENTION_TOKEN_CLASSES[kind] : undefined)}>{children}</span>
}

type LinkTokenProps = {
    children?: ReactNode
    node?: unknown
    title?: string
}

function LinkToken({ children, title }: LinkTokenProps) {
    return (
        <span title={title} className={cn('inline-flex items-baseline gap-[0.3em] font-medium underline-offset-2 [[data-streamdown=link]:hover>&]:underline', LINK_TOKEN_CLASS)}>
            <LinkIcon className="size-[0.85em] shrink-0 self-center" />
            {children}
        </span>
    )
}

const composerTokenComponents: Components = {
    [COMPOSER_MENTION_TAG]: MentionToken,
    [COMPOSER_LINK_TAG]: LinkToken,
}

const composerTokenAllowedTags = {
    [COMPOSER_MENTION_TAG]: [COMPOSER_MENTION_KIND_ATTRIBUTE],
    [COMPOSER_LINK_TAG]: ['title'],
}

const workspaceFileComponents: Components = {
    [AGENT_WORKSPACE_FILE_TAG]: WorkspaceFileLink,
}

const workspaceFileAllowedTags = {
    [AGENT_WORKSPACE_FILE_TAG]: [AGENT_WORKSPACE_FILE_PATH_ATTRIBUTE],
}

const NO_MENTIONS: ComposerMention[] = []

type AgentWorkspaceMessageProps = Omit<MessageResponseProps, 'allowedTags' | 'components' | 'remarkPlugins'> & {
    agentId?: string
    /** Bare URLs read as their short label, and these `@agent` and `/skill` as their token, as they did in the composer. */
    composerTokens?: boolean
    mentions?: ComposerMention[]
}

/** Message markdown with in-app navigation for absolute agent workspace links. */
export function AgentWorkspaceMessage({ agentId, composerTokens, mentions = NO_MENTIONS, ...props }: AgentWorkspaceMessageProps) {
    const remarkPlugins = useMemo(() => {
        const plugins: NonNullable<MessageResponseProps['remarkPlugins']> = [...Object.values(defaultRemarkPlugins)]
        if (agentId) plugins.push([remarkAgentWorkspaceLinks, { agentId }])
        if (composerTokens) plugins.push(remarkShortLinks, [remarkMentions, { mentions }])
        return plugins
    }, [agentId, composerTokens, mentions])

    const message = (
        <MessageResponse
            {...props}
            allowedTags={{ ...(agentId && workspaceFileAllowedTags), ...(composerTokens && composerTokenAllowedTags) }}
            components={{ ...(agentId && workspaceFileComponents), ...(composerTokens && composerTokenComponents) }}
            remarkPlugins={remarkPlugins}
        />
    )
    if (!agentId) return message

    return <AgentWorkspaceContext.Provider value={agentId}>{message}</AgentWorkspaceContext.Provider>
}
