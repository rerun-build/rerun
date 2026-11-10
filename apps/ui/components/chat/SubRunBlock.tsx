'use client'

import { ElapsedTime } from '@/components/chat/ElapsedTime'
import { StepRow } from '@/components/chat/StepRow'
import { SubRunTree } from '@/components/chat/SubRunTree'
import { ToolOutput, ToolSection, toolStatusOf, type ToolState } from '@/components/chat/ToolCallBlock'
import { useToolDisplay } from '@/hooks/useToolDisplay'
import { isSubRunLive, subRunHeadline, titledSubRun, type SubRunProgress } from '@/lib/chat/sub-run-progress'
import { readableToolError } from '@rerun/contracts'
import { ToolCallRow, type ToolCallStatus } from '@rerun/ui/chat'
import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState } from 'react'

type SubRunBlockProps = {
    toolName: string
    agentId?: string
    state: ToolState
    output?: unknown
    errorText?: string
    progress: SubRunProgress
    onStopTask?: (taskId: string) => void
    // One line among the folded steps, for a sub-run that has settled.
    dense?: boolean
}

export function SubRunBlock({ toolName, agentId, state, output, errorText, progress: reported, onStopTask, dense = false }: SubRunBlockProps) {
    const t = useTranslations('chat.tool')
    const tTools = useTranslations('tools')
    const tSubRuns = useTranslations('subRuns')
    const progress = titledSubRun(reported, tSubRuns)
    const toolDisplay = useToolDisplay(agentId)
    const { iconProps } = toolDisplay(toolName)
    const live = toolStatusOf(state) === 'running' && progress.tasks.some(isSubRunLive)
    const { label, summary } = subRunHeadline(progress, live, toolName, tSubRuns)

    // One agent being built has a single row that repeats the headline: it stays folded unless it failed.
    const single = toolName === 'build_team' && progress.tasks.length === 1
    const [open, setOpen] = useState(live && !single)
    const wasLive = useRef(live)
    useEffect(() => {
        if (wasLive.current && !live) setOpen(false)
        wasLive.current = live
    }, [live])

    const everyTaskFailed = progress.tasks.every(task => task.status === 'error')
    const status: ToolCallStatus = live ? 'running' : everyTaskFailed ? 'error' : toolStatusOf(state) === 'error' ? 'error' : 'done'

    const details = (
        <>
            <SubRunTree tasks={progress.tasks} toolDisplay={toolDisplay} onStopTask={onStopTask} />
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

    if (dense) {
        return (
            <StepRow iconProps={iconProps} label={label} detail={summary} status={status}>
                {details}
            </StepRow>
        )
    }

    return (
        <ToolCallRow
            label={label}
            summary={summary}
            icon={iconProps.icon}
            iconSrc={iconProps.src}
            status={status}
            open={open}
            onOpenChange={setOpen}
            elapsed={<ElapsedTime active={live} className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground" />}
        >
            {details}
        </ToolCallRow>
    )
}
