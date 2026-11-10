import * as Haptics from 'expo-haptics'
import { useState } from 'react'
import { View } from 'react-native'
import { useTranslations } from 'use-intl'

import { HitlAction, HitlCard, HitlIcon } from '@/components/chat/hitl/HitlCard'
import { AnswerInput, CustomOptionRow, OptionRow } from '@/components/chat/hitl/QuestionWidget'
import { Markdown } from '@/components/chat/Markdown'
import { AppText } from '@/components/ui/AppText'
import { Button } from '@/components/ui/Button'
import { spacing } from '@/theme/tokens'

import { readEither, readQuestion, type QuestionOutput } from '../parts'

type CardProps = { input: unknown; onAnswer: (output: QuestionOutput) => void }

// ask_choice and ask_input, drawn as the coworkers' question card: a pick answers a single choice on the
// spot, the free row and a question without options take a typed answer.
export function QuestionCard({ widget, input, onAnswer }: CardProps & { widget: 'ask_choice' | 'ask_input' }) {
    const { question, options, multiple } = readQuestion(widget, input)
    const [picked, setPicked] = useState<string[]>([])
    const [typed, setTyped] = useState('')
    const [open, setOpen] = useState(false)
    const t = useTranslations('mobileOnboarding')
    const answers = [...picked, typed.trim()].filter(Boolean)

    const send = (values: string[]) => onAnswer({ answered: true, question, answers: values })
    const pick = (option: string) => {
        Haptics.selectionAsync()
        if (!multiple) return send([option])
        setPicked(current => (current.includes(option) ? current.filter(value => value !== option) : [...current, option]))
    }

    return (
        <HitlCard symbol="questionmark.bubble" onClose={() => onAnswer({ answered: false, reason: 'dismissed' })} closeLabel={t('question.skip')}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingRight: spacing.xl }}>
                <HitlIcon symbol="questionmark.bubble" />
                <View style={{ flex: 1, minHeight: 32, justifyContent: 'center' }}>
                    <Markdown text={question} />
                </View>
            </View>
            {multiple && (
                <AppText variant="footnote" tone="muted">
                    {t('question.selectAll')}
                </AppText>
            )}
            {options.length === 0 ? (
                <View style={{ flexDirection: 'row' }}>
                    <AnswerInput value={typed} onChangeText={setTyped} onSubmit={() => answers.length && send(answers)} placeholder={t('question.typeAnswer')} last autoFocus />
                </View>
            ) : (
                <View style={{ gap: spacing.sm }}>
                    {options.map((option, position) => (
                        <OptionRow key={option} index={position} label={option} selected={picked.includes(option)} multiple={multiple} onPress={() => pick(option)} />
                    ))}
                    <CustomOptionRow open={open} onOpen={() => setOpen(true)}>
                        <AnswerInput value={typed} onChangeText={setTyped} onSubmit={() => answers.length && send(answers)} placeholder={t('question.somethingElse')} last autoFocus />
                    </CustomOptionRow>
                </View>
            )}
            {(multiple || open || options.length === 0) && (
                <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
                    <HitlAction label={t('question.send')} primary disabled={!answers.length} onPress={() => send(answers)} />
                </View>
            )}
        </HitlCard>
    )
}

// ask_either: a title, the line that says why, one button per answer and a way to turn both down.
export function EitherCard({ input, onAnswer }: CardProps) {
    const { title, description, options } = readEither(input)
    const t = useTranslations('mobileOnboarding')
    return (
        <HitlCard symbol="arrow.left.arrow.right">
            <View style={{ gap: spacing.xs, paddingRight: spacing.xl }}>
                <AppText variant="headline">{title}</AppText>
                {description.length > 0 && (
                    <AppText variant="callout" tone="muted">
                        {description}
                    </AppText>
                )}
            </View>
            <View style={{ gap: spacing.sm }}>
                {options.map(option => (
                    <Button key={option} label={option} variant="outline" onPress={() => onAnswer({ answered: true, question: title, answers: [option] })} />
                ))}
                <Button label={t('question.neither')} variant="ghost" size="sm" onPress={() => onAnswer({ answered: false, reason: 'neither' })} />
            </View>
        </HitlCard>
    )
}
