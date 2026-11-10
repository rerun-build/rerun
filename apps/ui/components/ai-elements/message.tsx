'use client'

import { Button } from '@/components/ui/button'
import { ButtonGroup, ButtonGroupText } from '@/components/ui/button-group'
import { DRAFT_LANGUAGE, DraftBlock } from '@/components/chat/DraftBlock'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { MESSAGE_STREAM_ANIMATION } from '@/lib/chat/stream-animation'
import { cn } from '@/lib/utils'
import { cjk } from '@streamdown/cjk'
import { code } from '@streamdown/code'
import { math } from '@streamdown/math'
import { mermaid } from '@streamdown/mermaid'
import { ChevronLeftIcon, ChevronRightIcon } from '@/lib/icons'
import type { ComponentProps, HTMLAttributes, ReactElement } from 'react'
import { createContext, memo, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { Streamdown } from 'streamdown'
import { useTranslations } from 'next-intl'

export { Message, MessageContent } from '@rerun/ui/chat'
export type { MessageProps, MessageContentProps } from '@rerun/ui/chat'

export type MessageActionsProps = ComponentProps<'div'>

export const MessageActions = ({ className, children, ...props }: MessageActionsProps) => (
    <div className={cn('flex items-center gap-1', className)} {...props}>
        {children}
    </div>
)

export type MessageActionProps = ComponentProps<typeof Button> & {
    tooltip?: string
    label?: string
}

export const MessageAction = ({ tooltip, children, label, variant = 'ghost', size = 'icon-sm', ...props }: MessageActionProps) => {
    const button = (
        <Button size={size} type="button" variant={variant} {...props}>
            {children}
            <span className="sr-only">{label || tooltip}</span>
        </Button>
    )

    if (tooltip) {
        return (
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>{button}</TooltipTrigger>
                    <TooltipContent>
                        <p>{tooltip}</p>
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>
        )
    }

    return button
}

interface MessageBranchContextType {
    currentBranch: number
    totalBranches: number
    goToPrevious: () => void
    goToNext: () => void
    branches: ReactElement[]
    setBranches: (branches: ReactElement[]) => void
}

const MessageBranchContext = createContext<MessageBranchContextType | null>(null)

const useMessageBranch = () => {
    const context = useContext(MessageBranchContext)

    if (!context) {
        throw new Error('MessageBranch components must be used within MessageBranch')
    }

    return context
}

export type MessageBranchProps = HTMLAttributes<HTMLDivElement> & {
    defaultBranch?: number
    onBranchChange?: (branchIndex: number) => void
}

export const MessageBranch = ({ defaultBranch = 0, onBranchChange, className, ...props }: MessageBranchProps) => {
    const [currentBranch, setCurrentBranch] = useState(defaultBranch)
    const [branches, setBranches] = useState<ReactElement[]>([])

    const handleBranchChange = useCallback(
        (newBranch: number) => {
            setCurrentBranch(newBranch)
            onBranchChange?.(newBranch)
        },
        [onBranchChange]
    )

    const goToPrevious = useCallback(() => {
        const newBranch = currentBranch > 0 ? currentBranch - 1 : branches.length - 1
        handleBranchChange(newBranch)
    }, [currentBranch, branches.length, handleBranchChange])

    const goToNext = useCallback(() => {
        const newBranch = currentBranch < branches.length - 1 ? currentBranch + 1 : 0
        handleBranchChange(newBranch)
    }, [currentBranch, branches.length, handleBranchChange])

    const contextValue = useMemo<MessageBranchContextType>(
        () => ({
            branches,
            currentBranch,
            goToNext,
            goToPrevious,
            setBranches,
            totalBranches: branches.length,
        }),
        [branches, currentBranch, goToNext, goToPrevious]
    )

    return (
        <MessageBranchContext.Provider value={contextValue}>
            <div className={cn('grid w-full gap-2 [&>div]:pb-0', className)} {...props} />
        </MessageBranchContext.Provider>
    )
}

export type MessageBranchContentProps = HTMLAttributes<HTMLDivElement>

export const MessageBranchContent = ({ children, ...props }: MessageBranchContentProps) => {
    const { currentBranch, setBranches, branches } = useMessageBranch()
    const childrenArray = useMemo(() => (Array.isArray(children) ? children : [children]), [children])

    // Use useEffect to update branches when they change
    useEffect(() => {
        if (branches.length !== childrenArray.length) {
            setBranches(childrenArray)
        }
    }, [childrenArray, branches, setBranches])

    return childrenArray.map((branch, index) => (
        <div className={cn('grid gap-2 overflow-hidden [&>div]:pb-0', index === currentBranch ? 'block' : 'hidden')} key={branch.key} {...props}>
            {branch}
        </div>
    ))
}

export type MessageBranchSelectorProps = ComponentProps<typeof ButtonGroup>

export const MessageBranchSelector = ({ className, ...props }: MessageBranchSelectorProps) => {
    const { totalBranches } = useMessageBranch()

    // Don't render if there's only one branch
    if (totalBranches <= 1) {
        return null
    }

    return <ButtonGroup className={cn('[&>*:not(:first-child)]:rounded-l-md [&>*:not(:last-child)]:rounded-r-md', className)} orientation="horizontal" {...props} />
}

export type MessageBranchPreviousProps = ComponentProps<typeof Button>

export const MessageBranchPrevious = ({ children, ...props }: MessageBranchPreviousProps) => {
    const t = useTranslations('chat.message.branch')
    const { goToPrevious, totalBranches } = useMessageBranch()

    return (
        <Button aria-label={t('previous')} disabled={totalBranches <= 1} onClick={goToPrevious} size="icon-sm" type="button" variant="ghost" {...props}>
            {children ?? <ChevronLeftIcon size={14} />}
        </Button>
    )
}

export type MessageBranchNextProps = ComponentProps<typeof Button>

export const MessageBranchNext = ({ children, ...props }: MessageBranchNextProps) => {
    const t = useTranslations('chat.message.branch')
    const { goToNext, totalBranches } = useMessageBranch()

    return (
        <Button aria-label={t('next')} disabled={totalBranches <= 1} onClick={goToNext} size="icon-sm" type="button" variant="ghost" {...props}>
            {children ?? <ChevronRightIcon size={14} />}
        </Button>
    )
}

export type MessageBranchPageProps = HTMLAttributes<HTMLSpanElement>

export const MessageBranchPage = ({ className, ...props }: MessageBranchPageProps) => {
    const t = useTranslations('chat.message.branch')
    const { currentBranch, totalBranches } = useMessageBranch()

    return (
        <ButtonGroupText className={cn('border-none bg-transparent text-muted-foreground shadow-none', className)} {...props}>
            {t('page', { current: currentBranch + 1, total: totalBranches })}
        </ButtonGroupText>
    )
}

export type MessageResponseProps = ComponentProps<typeof Streamdown>

const streamdownPlugins = { cjk, code, math, mermaid, renderers: [{ language: DRAFT_LANGUAGE, component: DraftBlock }] }
const linkSafetyOff = { enabled: false }

// Streamdown only installs the animation plugin while `isAnimating` is on, so the word spans
// exist for the answer being written and nowhere else: a read-only transcript stays plain DOM.
export const MessageResponse = memo(
    ({ className, isAnimating, animated, ...props }: MessageResponseProps) => (
        <Streamdown
            className={cn('size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0', className)}
            plugins={streamdownPlugins}
            linkSafety={linkSafetyOff}
            isAnimating={isAnimating}
            animated={animated ?? (isAnimating ? MESSAGE_STREAM_ANIMATION : undefined)}
            {...props}
        />
    ),
    // remarkPlugins counts: the skills a message mentions can arrive after it has rendered.
    (prevProps, nextProps) => prevProps.children === nextProps.children && nextProps.isAnimating === prevProps.isAnimating && prevProps.animated === nextProps.animated && prevProps.remarkPlugins === nextProps.remarkPlugins
)

MessageResponse.displayName = 'MessageResponse'

export type MessageToolbarProps = ComponentProps<'div'>

export const MessageToolbar = ({ className, children, ...props }: MessageToolbarProps) => (
    <div className={cn('mt-4 flex w-full items-center justify-between gap-4', className)} {...props}>
        {children}
    </div>
)
