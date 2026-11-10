'use client'

import { ElapsedTime } from '@/components/chat/ElapsedTime'
import { StepRow } from '@/components/chat/StepRow'
import { useToolDisplay } from '@/hooks/useToolDisplay'
import { agentIdOf, argsOf, toolHeadline } from '@/lib/chat/tool-headline'
import { cn } from '@/lib/utils'
import { useBoardStore } from '@/stores/board.store'
import { readableToolError } from '@rerun/contracts'
import { ToolCallRow, type ToolCallStatus } from '@rerun/ui/chat'
import { useTranslations } from 'next-intl'

export type ToolState = 'input-streaming' | 'input-available' | 'output-available' | 'output-error' | 'output-denied' | 'approval-requested' | 'approval-responded'

type ToolCallBlockProps = {
    toolName: string
    agentId?: string
    state: ToolState
    input?: unknown
    inputText?: string
    output?: unknown
    errorText?: string
}

export function toolStatusOf(state: ToolState): ToolCallStatus {
    switch (state) {
        case 'output-available':
            return 'done'
        case 'output-error':
        case 'output-denied':
            return 'error'
        default:
            return 'running'
    }
}

const hasDetails = ({ input, inputText, output, errorText }: ToolCallBlockProps) => Object.keys(argsOf(input) ?? {}).length > 0 || output !== undefined || !!inputText || !!errorText

/** A tool call on one line of the folded steps: what it was called with, and the full exchange on click. */
export function ToolCallStep(props: ToolCallBlockProps) {
    const tTools = useTranslations('tools')
    const { label, iconProps } = useToolDisplay(props.agentId)(props.toolName, props.input)
    const status = toolStatusOf(props.state)
    const targetAgentId = agentIdOf(props.input)
    const targetAgentName = useBoardStore(s => s.agents.find(agent => agent.id === targetAgentId)?.name)
    return (
        <StepRow
            iconProps={iconProps}
            label={label}
            detail={status === 'error' && props.errorText ? readableToolError(props.errorText, tTools) : toolHeadline(props.input, targetAgentName)}
            status={status}
            elapsed={<ElapsedTime active={status === 'running'} className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/70" />}
        >
            {hasDetails(props) && <ToolCallDetails {...props} />}
        </StepRow>
    )
}

export function ToolCallBlock(props: ToolCallBlockProps) {
    const { label, iconProps } = useToolDisplay(props.agentId)(props.toolName, props.input)
    const running = toolStatusOf(props.state) === 'running'

    return (
        <ToolCallRow
            label={label}
            icon={iconProps.icon}
            iconSrc={iconProps.src}
            status={toolStatusOf(props.state)}
            elapsed={<ElapsedTime active={running} className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground" />}
        >
            {hasDetails(props) && <ToolCallDetails {...props} />}
        </ToolCallRow>
    )
}

function ToolCallDetails({ toolName, state, input, inputText, output, errorText }: ToolCallBlockProps) {
    const t = useTranslations('chat.tool')
    const tTools = useTranslations('tools')
    const args = argsOf(input)
    return (
        <>
            {state === 'input-streaming' && inputText && (
                <ToolSection label={t('input')}>
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-background px-2 py-1.5 text-xs font-mono text-foreground opacity-60">{inputText}</pre>
                </ToolSection>
            )}
            {args && Object.keys(args).length > 0 && (
                <ToolSection label={t('input')}>
                    <ToolArgs args={args} toolName={toolName} />
                </ToolSection>
            )}
            {errorText && (
                <ToolSection label={t('error')}>
                    <p className="rounded bg-red-950/20 px-2 py-1.5 text-xs text-red-400">{readableToolError(errorText, tTools)}</p>
                </ToolSection>
            )}
            {output !== undefined && (
                <ToolSection label={t('output')}>
                    <ToolOutput output={output} />
                </ToolSection>
            )}
        </>
    )
}

export function ToolSection({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div>
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
            <div className="mt-0.5">{children}</div>
        </div>
    )
}

function ToolArgs({ args, toolName }: { args: Record<string, unknown>; toolName: string }) {
    if (typeof args.preview === 'string' && Object.keys(args).length <= 1) {
        return <code className="block whitespace-pre-wrap break-all rounded bg-background px-2 py-1.5 text-xs font-mono text-foreground">{args.preview}</code>
    }

    if (toolName === 'shell_exec' && typeof args.command === 'string') {
        return <code className="block whitespace-pre-wrap break-all rounded bg-background px-2 py-1.5 text-xs font-mono text-foreground">{args.command}</code>
    }

    if (/^(fs|shared)_(read|write|edit|list|search)$/.test(toolName) && typeof args.path === 'string') {
        return <code className="block whitespace-pre-wrap break-all rounded bg-background px-2 py-1.5 text-xs font-mono text-foreground">{args.path}</code>
    }

    return <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-background px-2 py-1.5 text-xs font-mono text-foreground">{JSON.stringify(args, null, 2)}</pre>
}

export function ToolOutput({ output }: { output: unknown }) {
    const t = useTranslations('chat.tool')
    if (output && typeof output === 'object' && 'duration' in output && Object.keys(output).length === 1) {
        const duration = (output as { duration?: number }).duration
        if (typeof duration === 'number') {
            return <span className="text-xs text-muted-foreground">{t('completedIn', { duration: duration < 1 ? `${Math.round(duration * 1000)}ms` : `${duration.toFixed(1)}s` })}</span>
        }
    }

    const text = typeof output === 'string' ? output : JSON.stringify(output, null, 2)
    const truncated = text.length > 2000

    return (
        <pre className={cn(
            'max-h-60 overflow-auto whitespace-pre-wrap break-all rounded bg-background px-2 py-1.5 text-xs font-mono text-foreground',
            truncated && 'relative after:absolute after:inset-x-0 after:bottom-0 after:h-8 after:bg-linear-to-t after:from-background after:to-transparent'
        )}>
            {truncated ? text.slice(0, 2000) + '…' : text}
        </pre>
    )
}
