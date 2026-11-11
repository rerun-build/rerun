import { pendingQuestions, serializeAnswers } from '@rerun/contracts'
import { useRef, useState, type ReactNode } from 'react'
import { Alert, Pressable, TextInput, View } from 'react-native'
import { useTranslations } from 'use-intl'

import { AppText } from '@/components/ui/AppText'
import { Icon } from '@/components/ui/Icon'
import * as Haptics from '@/lib/haptics'
import { fieldOutline } from '@/theme/field'
import { useTheme } from '@/theme/theme'
import { fonts, radius, spacing } from '@/theme/tokens'

import { AttachmentStrip } from '../AttachmentStrip'
import type { ComposerAttachment } from '../attachments'
import { AttachMenu, RoundButton } from '../ComposerControls'
import { Markdown } from '../Markdown'
import { useAttachmentPicker } from '../useAttachmentPicker'
import { useVoiceMessage, type VoiceSender } from '../useVoiceMessage'
import { VoiceRecorderBar } from '../VoiceRecorderBar'
import { HitlAction, HitlCard, HitlIcon } from './HitlCard'
import { HitlSteps } from './HitlSteps'
import type { HitlWidgetProps } from './registry'

type Answer = { picked: string[]; typed: string; files: ComposerAttachment[] }

const EMPTY: Answer = { picked: [], typed: '', files: [] }

const isAnswered = (answer: Answer | undefined) => Boolean(answer && (answer.picked.length > 0 || answer.typed.trim() || answer.files.length > 0))

const ROW = { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 48, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, borderCurve: 'continuous', borderWidth: 1 } as const

export function OptionRow({ index, label, description, selected, multiple, onPress }: { index: number; label: string; description?: string; selected: boolean; multiple: boolean; onPress: () => void }) {
    const theme = useTheme()
    return (
        <Pressable onPress={onPress} accessibilityRole={multiple ? 'checkbox' : 'button'} accessibilityLabel={label} accessibilityState={{ checked: multiple ? selected : undefined, selected }} style={({ pressed }) => ({ ...ROW, borderColor: selected ? theme.foreground : theme.border, backgroundColor: pressed ? theme.muted : 'transparent' })}>
            <View style={{ width: 22, height: 22, borderRadius: multiple ? 6 : 11, alignItems: 'center', justifyContent: 'center', backgroundColor: selected ? theme.foreground : theme.muted }}>
                {selected ? (
                    <Icon name="check" size={11} bold color={theme.background} />
                ) : (
                    <AppText variant="caption" tone="muted" medium>
                        {index + 1}
                    </AppText>
                )}
            </View>
            {description ? (
                <View style={{ flex: 1, gap: 2 }}>
                    <AppText variant="body">{label}</AppText>
                    <AppText variant="footnote" tone="muted" numberOfLines={2}>
                        {description}
                    </AppText>
                </View>
            ) : (
                <AppText variant="body" style={{ flex: 1 }}>
                    {label}
                </AppText>
            )}
        </Pressable>
    )
}

export function AnswerInput({ value, onChangeText, onSubmit, placeholder, last, autoFocus }: { value: string; onChangeText: (text: string) => void; onSubmit: () => void; placeholder: string; last: boolean; autoFocus?: boolean }) {
    const t = useTranslations('mobileHitl.question')
    const theme = useTheme()
    const [focused, setFocused] = useState(false)
    return <TextInput value={value} onChangeText={onChangeText} onSubmitEditing={onSubmit} submitBehavior="submit" returnKeyType={last ? 'send' : 'next'} multiline autoFocus={autoFocus} placeholder={placeholder} placeholderTextColor={theme.mutedForeground} accessibilityLabel={t('yourAnswer')} testID="hitl-answer" onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} style={{ flex: 1, minHeight: 48, maxHeight: 160, paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.md, borderRadius: radius.md, borderCurve: 'continuous', ...fieldOutline(theme, { focused }), backgroundColor: theme.background, color: theme.foreground, fontFamily: fonts.regular, fontSize: 16 }} />
}

// The web's "Something else" row: a pencil and a label until it is tapped, then the field itself.
export function CustomOptionRow({ open, onOpen, children }: { open: boolean; onOpen: () => void; children: ReactNode }) {
    const t = useTranslations('mobileHitl.question')
    const theme = useTheme()
    if (open) return <View style={{ flexDirection: 'row' }}>{children}</View>
    return (
        <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={t('somethingElse')} style={({ pressed }) => ({ ...ROW, borderColor: theme.border, backgroundColor: pressed ? theme.muted : 'transparent' })}>
            <View style={{ width: 22, height: 22, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.muted }}>
                <Icon name="pencil" size={11} bold color={theme.mutedForeground} />
            </View>
            <AppText variant="body" tone="muted" style={{ flex: 1 }}>
                {t('somethingElse')}
            </AppText>
        </Pressable>
    )
}

// The questions a coworker stopped on, one at a time, answered inside the card as on the web: the
// composer steps aside while they wait, so the card carries its own paperclip and microphone. A
// single-choice option answers at once; "Something else" and a question without options take a typed
// answer. Every answer leaves in one message once the last question is passed, written as the web
// writes it, the files uploaded first so the message only names their paths.
export function QuestionWidget({ pending, onAnswer, onDismiss, upload, transcribe }: HitlWidgetProps) {
    const t = useTranslations('mobileHitl')
    const questions = pendingQuestions(pending.input)
    const [index, setIndex] = useState(0)
    const [answers, setAnswers] = useState<Answer[]>(() => questions.map(() => EMPTY))
    const [customOpen, setCustomOpen] = useState<boolean[]>(() => questions.map(() => false))
    const [sending, setSending] = useState(false)
    const sent = useRef(false)
    // The recorder is the card's, the words go to the question that opened it.
    const recordingAt = useRef(0)
    const question = questions[index]
    const last = index === questions.length - 1

    const withAnswer = (at: number, value: Answer) => answers.map((current, step) => (step === at ? value : current))
    const setOpen = (at: number, open: boolean) => setCustomOpen(current => current.map((value, step) => (step === at ? open : value)))
    const answerAt = (at: number) => answers[at] ?? EMPTY

    const picker = useAttachmentPicker(answerAt(index).files, files => setAnswers(withAnswer(index, { ...answerAt(index), files })))

    const voice: VoiceSender | undefined = transcribe
        ? {
              transcribe,
              // Read at delivery time: the answer can have been typed into while the microphone was on.
              send: async transcript => {
                  const at = recordingAt.current
                  setAnswers(current => {
                      const answer = current[at] ?? EMPTY
                      const typed = answer.typed.trim()
                      return current.map((value, step) => (step === at ? { ...answer, typed: typed ? `${typed} ${transcript}` : transcript } : value))
                  })
              },
          }
        : undefined
    const recorder = useVoiceMessage(voice)
    const recording = recorder.status !== 'idle'

    const submit = async (next: Answer[]) => {
        if (sent.current) return
        sent.current = true
        setSending(true)
        try {
            const paths = upload ? await Promise.all(next.map(answer => Promise.all(answer.files.map(file => upload(file))))) : next.map(() => [])
            onAnswer(serializeAnswers(questions.map((item, at) => ({ question: item.question, answers: [...(next[at]?.picked ?? []), next[at]?.typed.trim() ?? ''], attachments: paths[at] }))))
        } catch {
            sent.current = false
            setSending(false)
            Alert.alert(t('question.uploadFailed'))
        }
    }

    const advance = (next: Answer[], from = index) => {
        setAnswers(next)
        if (from < questions.length - 1) {
            setIndex(from + 1)
            return
        }
        void submit(next)
    }

    const pick = (at: number, option: string) => {
        Haptics.selectionAsync()
        const step = questions[at]
        const current = answerAt(at)
        if (!step.multiple) {
            setOpen(at, false)
            advance(withAnswer(at, { picked: [option], typed: '', files: current.files }), at)
            return
        }
        const picked = current.picked.includes(option) ? current.picked.filter(value => value !== option) : [...current.picked, option]
        setAnswers(withAnswer(at, { ...current, picked }))
    }

    const openCustom = (at: number) => {
        setOpen(at, true)
        if (!questions[at].multiple) setAnswers(withAnswer(at, { ...EMPTY, files: answerAt(at).files }))
    }

    const type = (at: number, typed: string) => setAnswers(withAnswer(at, { ...answerAt(at), typed }))

    const skip = () => {
        setOpen(index, false)
        advance(withAnswer(index, EMPTY))
    }

    const startRecording = async () => {
        recordingAt.current = index
        if (questions[index].options.length > 0) openCustom(index)
        if (await recorder.start()) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    }

    if (!question) return null

    const actions = recording ? (
        <>
            <RoundButton symbol="x" label={t('question.discardRecording')} tone="plain" disabled={recorder.status === 'processing'} onPress={() => void recorder.discard()} />
            {recorder.status === 'failed' ? <RoundButton symbol="rotate-cw" label={t('question.retryRecording')} tone="primary" onPress={recorder.retry} /> : <RoundButton symbol="check" label={t('question.useRecording')} tone="primary" busy={recorder.status !== 'recording'} onPress={() => void recorder.finish()} />}
        </>
    ) : (
        <>
            {upload && <AttachMenu onPhotos={picker.pickPhotos} onCamera={picker.takePhoto} onFiles={picker.pickFiles} />}
            {transcribe && <RoundButton symbol="mic" label={t('question.record')} tone="plain" onPress={() => void startRecording()} />}
            <HitlAction label={t('actions.skip')} onPress={skip} disabled={sending} />
            <HitlAction label={last ? t('actions.send') : t('actions.next')} primary onPress={() => advance(answers)} disabled={sending} />
        </>
    )

    return (
        <HitlCard symbol="message-circle-question" onClose={onDismiss} closeLabel={t('question.dismiss')}>
            <HitlSteps
                count={questions.length}
                index={index}
                onIndexChange={setIndex}
                done={at => isAnswered(answers[at])}
                renderStep={at => {
                    const step = questions[at]
                    const answer = answerAt(at)
                    const live = recorder.status !== 'idle' && at === recordingAt.current ? recorder.status : null
                    const input = (placeholder: string, autoFocus?: boolean) =>
                        live ? <VoiceRecorderBar status={live} error={recorder.error} getLiveState={recorder.getLiveState} /> : <AnswerInput value={answer.typed} onChangeText={text => type(at, text)} onSubmit={() => advance(answers, at)} placeholder={placeholder} last={at === questions.length - 1} autoFocus={autoFocus} />
                    return (
                        <>
                            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingRight: spacing.xl }}>
                                <HitlIcon symbol="message-circle-question" />
                                <View style={{ flex: 1, minHeight: 32, justifyContent: 'center' }}>
                                    {step.header && (
                                        <AppText variant="footnote" tone="muted" medium numberOfLines={1}>
                                            {step.header}
                                        </AppText>
                                    )}
                                    <Markdown text={step.question} />
                                </View>
                            </View>
                            {step.multiple && step.options.length > 0 && (
                                <AppText variant="footnote" tone="muted">
                                    {t('question.selectAll')}
                                </AppText>
                            )}
                            {answer.files.length > 0 && <AttachmentStrip attachments={answer.files} onRemove={uri => setAnswers(withAnswer(at, { ...answer, files: answer.files.filter(file => file.uri !== uri) }))} />}
                            {step.options.length === 0 ? (
                                <View style={{ flexDirection: 'row' }}>{input(t('question.typeAnswer'))}</View>
                            ) : (
                                <View style={{ gap: spacing.sm }}>
                                    {step.options.map((option, position) => (
                                        <OptionRow key={option.label} index={position} label={option.label} description={option.description} selected={answer.picked.includes(option.label)} multiple={Boolean(step.multiple)} onPress={() => pick(at, option.label)} />
                                    ))}
                                    <CustomOptionRow open={Boolean(customOpen[at])} onOpen={() => openCustom(at)}>
                                        {input(t('question.somethingElse'), true)}
                                    </CustomOptionRow>
                                </View>
                            )}
                        </>
                    )
                }}
                actions={actions}
            />
        </HitlCard>
    )
}
