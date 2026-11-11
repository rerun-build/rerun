'use client'

import { Button, ScrollFade } from '../primitives'
import { BorderBeam } from '../BorderBeam'
import { cn } from '../cn'
import { ArrowRight, Check, MicIcon, PaperclipIcon, X } from '../icons'
import { AnimatePresence, motion } from 'motion/react'
import { useImperativeHandle, useRef, useState, type ComponentProps, type ReactNode, type Ref, type RefObject } from 'react'
import { useForm } from 'react-hook-form'
import type { QuestionItem } from '@rerun/contracts'
import { CustomOptionRow, OptionRow } from './OptionRow'
import { StepDots } from './StepDots'
import { useKitTranslations } from '../locale'

export type { QuestionItem }

// The form only collects the picked files: transferring them and rendering their chips belongs to
// the host, which is why the landing previews can render the form without any upload behind it.
export type QuestionAttachments = {
    onPick: (questionIndex: number, files: File[]) => void
    onClear: (questionIndex: number) => void
    count: (questionIndex: number) => number
    // Rendered inline, between the answer input and the attach button.
    render: (questionIndex: number) => ReactNode
    accept?: string
}

export type QuestionVoiceStatus = 'idle' | 'starting' | 'recording' | 'transcribing'

// Same split as the attachments: the host owns the microphone and the transcription, the form owns
// where the button sits and what the transcript does to the answer.
export type QuestionVoice = {
    status: QuestionVoiceStatus
    // The form hands over where the words go. The host writes there when the user validates the
    // recording, and on its own when the recording hits the length cap the recorder stops at.
    start: (deliver: (transcript: string) => void) => void
    finish: () => void
    discard: () => void
    // Drawn in place of the answer field while recording: the live waveform and its timer.
    render: () => ReactNode
}

export type QuestionFormHandle = {
    // Re-reads the answer after the host wrote into the textarea directly (picking a mention does).
    sync: (text: string) => void
}

export type QuestionFormProps = {
    ref?: Ref<QuestionFormHandle>
    questions: QuestionItem[]
    // A rejected promise reopens the form, so a failed attachment can be fixed before answering again.
    onSubmit: (answers: { question: string; answers: string[] }[]) => void | Promise<void>
    onCancel?: () => void
    disabled?: boolean
    renderText?: (text: string) => ReactNode
    attachments?: QuestionAttachments
    voice?: QuestionVoice
    // Rendered in the conversation's own scroll rather than pinned above the composer: no dock
    // margin, and no autofocus, which would yank the thread down to the block.
    inline?: boolean
    className?: string
    textareaRef?: RefObject<HTMLTextAreaElement | null>
    textareaProps?: Pick<ComponentProps<'textarea'>, 'onChange' | 'onSelect' | 'onKeyDown'>
}

type QuestionAnswer = { selected: string[]; custom: string }

const EMPTY_ANSWER: QuestionAnswer = { selected: [], custom: '' }

export function QuestionForm({ ref, questions, onSubmit, onCancel, disabled, renderText = text => text, attachments, voice, inline, className, textareaRef, textareaProps }: QuestionFormProps) {
    const t = useKitTranslations()
    const form = useForm<Record<string, QuestionAnswer>>({ defaultValues: {} })
    const answers = form.watch()
    const [customOpen, setCustomOpen] = useState<Record<number, boolean>>({})
    const [submitted, setSubmitted] = useState(false)
    const [current, setCurrent] = useState(0)
    const [dragging, setDragging] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)
    // The state above only drives the disabled styling. Answering the agent twice starts two runs
    // on the same conversation, so the latch that guards it has to be a ref: two callbacks fired
    // from the same render both read the same stale `submitted`.
    const submittedRef = useRef(false)
    const claimSubmit = () => {
        if (submittedRef.current) return false
        submittedRef.current = true
        setSubmitted(true)
        return true
    }
    const releaseSubmit = () => {
        submittedRef.current = false
        setSubmitted(false)
    }

    const locked = disabled || submitted
    const last = questions.length - 1

    const answerAt = (i: number, source: Record<string, QuestionAnswer> = answers): QuestionAnswer => source[String(i)] ?? EMPTY_ANSWER

    const valuesAt = (i: number, source: Record<string, QuestionAnswer> = answers) => {
        const value = answerAt(i, source)
        return [...value.selected, value.custom.trim()].filter(Boolean)
    }

    const setAnswer = (i: number, value: QuestionAnswer) => form.setValue(String(i), value)

    const hasAnswer = (i: number) => valuesAt(i).length > 0 || (attachments?.count(i) ?? 0) > 0

    const isMultiple = (i: number) => questions[i].multiple === true && questions[i].options.length > 0

    // While the microphone is on, the answer field is the recording bar: moving to another question or
    // picking an option would leave the words with nowhere to land.
    const recording = voice !== undefined && voice.status !== 'idle'

    const chooseOption = (i: number, opt: string) => {
        if (locked || recording) return
        const value = answerAt(i)
        if (isMultiple(i)) {
            setAnswer(i, { ...value, selected: value.selected.includes(opt) ? value.selected.filter(o => o !== opt) : [...value.selected, opt] })
            return
        }
        setCustomOpen(prev => ({ ...prev, [i]: false }))
        setAnswer(i, { selected: [opt], custom: '' })
        attachments?.onClear(i)
        advance()
    }

    const openCustom = (i: number) => {
        if (locked || recording || customOpen[i]) return
        setCustomOpen(prev => ({ ...prev, [i]: true }))
        if (isMultiple(i)) return
        setAnswer(i, EMPTY_ANSWER)
        attachments?.onClear(i)
    }

    const pickFiles = (i: number, files: File[]) => {
        if (locked || !attachments || files.length === 0) return
        if (questions[i].options.length > 0) openCustom(i)
        attachments.onPick(i, files)
    }

    const setCustom = (i: number, custom: string) => {
        if (locked) return
        setAnswer(i, { ...answerAt(i), custom })
    }

    const startVoice = (i: number) => {
        if (locked || !voice || recording) return
        if (questions[i].options.length > 0) openCustom(i)
        voice.start(transcript => {
            // Read back at delivery time: the answer can have been typed into while the microphone was on.
            const typed = answerAt(i, form.getValues()).custom.trim()
            setCustom(i, typed ? `${typed} ${transcript}` : transcript)
        })
    }

    useImperativeHandle(ref, () => ({ sync: text => setCustom(current, text) }))

    const submit = async () => {
        if (!claimSubmit()) return
        const final = form.getValues()
        try {
            await onSubmit(questions.map((q, i) => ({ question: q.question, answers: valuesAt(i, final) })))
        } catch {
            releaseSubmit()
        }
    }

    const cancel = () => {
        if (!claimSubmit()) return
        onCancel?.()
    }

    const advance = () => {
        if (disabled || submittedRef.current) return
        if (current < last) setCurrent(c => c + 1)
        else void submit()
    }

    const skip = () => {
        if (locked) return
        setAnswer(current, EMPTY_ANSWER)
        setCustomOpen(prev => ({ ...prev, [current]: false }))
        attachments?.onClear(current)
        advance()
    }

    const paginated = questions.length > 1
    const q = questions[current]
    const value = answerAt(current)
    const isCustom = !!customOpen[current]
    const freeText = q.options.length === 0
    const multi = isMultiple(current)

    // Both buttons live in the footer rather than in the answer field: on a question with options the
    // field only exists once "Something else" is open, which is exactly when a coworker asking for a
    // file would have left the answer no way to carry one.
    const attachButton = attachments && (
        <Button
            size="icon-sm"
            variant="ghost"
            disabled={locked || recording}
            onClick={e => {
                e.stopPropagation()
                fileInputRef.current?.click()
            }}
            aria-label={t('chat.question.attachFiles')}
            data-hitl="attach"
            className="shrink-0 text-muted-foreground"
        >
            <PaperclipIcon className="size-4" />
        </Button>
    )

    const recordButton = voice && (
        <Button
            size="icon-sm"
            variant="ghost"
            disabled={locked || recording}
            onClick={e => {
                e.stopPropagation()
                startVoice(current)
            }}
            aria-label={t('chat.question.record')}
            data-hitl="record"
            className="shrink-0 text-muted-foreground"
        >
            <MicIcon className="size-4" />
        </Button>
    )

    const recordingBar = voice && (
        <div className="flex min-w-0 flex-1 items-center gap-2" onClick={e => e.stopPropagation()}>
            {voice.render()}
            <Button size="icon-sm" variant="ghost" disabled={voice.status === 'transcribing'} onClick={voice.discard} aria-label={t('chat.question.discardRecording')} data-hitl="record-discard" className="shrink-0 text-muted-foreground">
                <X className="size-4" />
            </Button>
            <Button size="icon-sm" disabled={voice.status !== 'recording'} onClick={voice.finish} aria-label={t('chat.question.useRecording')} data-hitl="record-stop" className="shrink-0">
                <Check className="size-4" />
            </Button>
        </div>
    )

    const answerInput = recording ? (
        recordingBar
    ) : (
        <>
            <textarea
                ref={textareaRef}
                autoFocus={!inline}
                rows={1}
                value={value.custom}
                onChange={e => {
                    setCustom(current, e.target.value)
                    textareaProps?.onChange?.(e)
                }}
                onSelect={textareaProps?.onSelect}
                onClick={e => e.stopPropagation()}
                onKeyDown={e => {
                    e.stopPropagation()
                    textareaProps?.onKeyDown?.(e)
                    if (e.defaultPrevented) return
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        advance()
                    }
                }}
                onPaste={e => {
                    const files = Array.from(e.clipboardData.files)
                    if (!attachments || files.length === 0) return
                    e.preventDefault()
                    pickFiles(current, files)
                }}
                placeholder={freeText ? t('chat.question.typeAnswer') : t('chat.question.somethingElse')}
                disabled={locked}
                className="field-sizing-content max-h-40 min-h-7 flex-1 resize-none bg-transparent py-1 text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
            {attachments?.render(current)}
        </>
    )

    return (
        <div
            className={cn('relative space-y-3 overflow-hidden rounded-lg border border-border bg-muted/30 p-3', !inline && 'mb-2', className)}
            onDragOver={e => {
                if (!attachments || locked || !e.dataTransfer.types.includes('Files')) return
                e.preventDefault()
                setDragging(true)
            }}
            onDragLeave={e => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
            }}
            onDrop={e => {
                if (!attachments) return
                e.preventDefault()
                setDragging(false)
                pickFiles(current, Array.from(e.dataTransfer.files))
            }}
        >
            <BorderBeam animated pattern="arcs" tone="brand" glow width={1} duration={7} />
            {attachments && (
                <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    hidden
                    accept={attachments.accept}
                    onChange={e => {
                        const files = Array.from(e.target.files ?? [])
                        e.target.value = ''
                        pickFiles(current, files)
                    }}
                />
            )}
            {dragging && (
                <div className="pointer-events-none absolute inset-0 z-10 m-0! flex items-center justify-center rounded-lg border border-dashed border-primary bg-background/80 text-sm font-medium text-foreground">
                    {t('chat.question.dropFiles')}
                </div>
            )}

            <div className="flex items-start gap-2.5 text-sm">
                <AnimatePresence mode="wait" initial={false}>
                    <motion.div key={current} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="min-w-0 flex-1 font-medium leading-snug">
                        {q.header && <span className="mb-1 block truncate text-xs font-medium text-muted-foreground">{q.header}</span>}
                        <ScrollFade className="max-h-24">{renderText(q.question)}</ScrollFade>
                        {multi && <span className="mt-1 block text-xs font-normal text-muted-foreground">{t('chat.question.selectAll')}</span>}
                    </motion.div>
                </AnimatePresence>
                {onCancel && (
                    <div className="flex shrink-0 items-center gap-0.5">
                        <Button size="icon-sm" variant="ghost" disabled={locked} onClick={cancel} aria-label={t('chat.question.dismiss')} data-hitl="dismiss" className="-my-1 text-muted-foreground">
                            <X className="size-4" />
                        </Button>
                    </div>
                )}
            </div>

            <AnimatePresence mode="wait" initial={false}>
                <motion.div key={current} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                    <ScrollFade className="-mx-1 max-h-68">
                        <div className="space-y-0.5">
                            {freeText ? (
                                <div className="flex w-full items-start gap-2.5 rounded-md px-2 py-2">{answerInput}</div>
                            ) : (
                                <>
                                    {q.options.map((opt, oi) => (
                                        <OptionRow
                                            key={oi}
                                            index={oi}
                                            label={renderText(opt.label)}
                                            description={opt.description && renderText(opt.description)}
                                            selected={value.selected.includes(opt.label)}
                                            multi={multi}
                                            disabled={locked || recording}
                                            onChoose={() => chooseOption(current, opt.label)}
                                        />
                                    ))}

                                    <CustomOptionRow open={isCustom} onOpen={() => openCustom(current)}>
                                        {answerInput}
                                    </CustomOptionRow>
                                </>
                            )}
                        </div>
                    </ScrollFade>
                </motion.div>
            </AnimatePresence>

            <div className="flex items-center justify-between gap-2 px-1">
                {paginated ? (
                    <StepDots
                        count={questions.length}
                        current={current}
                        answered={questions.map((_, i) => hasAnswer(i))}
                        onSelect={i => {
                            if (!locked && !recording) setCurrent(i)
                        }}
                        disabled={locked || recording}
                    />
                ) : (
                    <div />
                )}
                <div className="flex items-center gap-2">
                    {(attachments || voice) && (
                        <div className="flex items-center">
                            {attachButton}
                            {recordButton}
                        </div>
                    )}
                    <Button size="sm" variant="outline" disabled={locked || recording} onClick={skip} data-hitl="skip">
                        {t('chat.question.skip')}
                    </Button>
                    <Button size="icon-sm" disabled={locked || recording} onClick={() => advance()} aria-label={current === last ? t('chat.question.submit') : t('chat.question.next')} data-hitl="next">
                        <ArrowRight className="size-4" />
                    </Button>
                </div>
            </div>
        </div>
    )
}
