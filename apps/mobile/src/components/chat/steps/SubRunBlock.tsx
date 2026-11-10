import { isSubRunLive, readableToolError, subRunHeadline, titledSubRun, type SubRunProgress } from '@rerun/contracts'
import { View } from 'react-native'
import { useTranslations } from 'use-intl'

import { AppText } from '@/components/ui/AppText'
import { spacing } from '@/theme/tokens'

import { StepRow, toolStatusOf, type StepStatus } from './StepGroup'
import { SubRunTree } from './SubRunTree'
import { toolSymbolOf } from './toolSymbols'

type SubRunBlockProps = { toolName: string; state: string | undefined; errorText?: string; progress: SubRunProgress; onStopTask?: (taskId: string) => void }

export function subRunStatus(progress: SubRunProgress, state: string | undefined): StepStatus {
    const live = toolStatusOf(state) === 'running' && progress.tasks.some(isSubRunLive)
    if (live) return 'running'
    return progress.tasks.every(task => task.status === 'error') || toolStatusOf(state) === 'error' ? 'error' : 'done'
}

/**
 * Coworkers working for this one: delegated tasks, a coworker called, a team being built. While they
 * run the block stands open on the tree of tasks; once settled it is one line among the steps.
 */
export function SubRunBlock({ toolName, state, errorText, progress: reported, onStopTask }: SubRunBlockProps) {
    const tTools = useTranslations('tools')
    const tSubRuns = useTranslations('subRuns')
    const progress = titledSubRun(reported, tSubRuns)
    const status = subRunStatus(progress, state)
    const live = status === 'running'
    const { label, summary } = subRunHeadline(progress, live, toolName, tSubRuns)
    const single = toolName === 'build_team' && progress.tasks.length === 1
    return (
        <StepRow symbol={toolSymbolOf(toolName)} label={label} detail={summary} status={status} defaultOpen={live && !single}>
            <View style={{ gap: spacing.xs }}>
                <SubRunTree tasks={progress.tasks} onStopTask={onStopTask} />
                {errorText ? (
                    <AppText variant="footnote" tone="destructive" selectable>
                        {readableToolError(errorText, tTools)}
                    </AppText>
                ) : null}
            </View>
        </StepRow>
    )
}
