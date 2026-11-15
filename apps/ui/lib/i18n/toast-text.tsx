import { useErrorText, type Refusal } from '@/hooks/useErrorText'
import { useTranslations } from 'next-intl'

type MessageKey = string
type MessageValues = Record<string, string | number>

function TranslatedText({ id, values }: { id: MessageKey; values?: MessageValues }) {
    const t = useTranslations()
    return t(id as never, values as never)
}

function RefusalText({ refusal }: { refusal: Refusal }) {
    const errorText = useErrorText()
    return errorText(refusal)
}

export const translated = (id: MessageKey, values?: MessageValues) => <TranslatedText id={id} values={values} />

export const refusalText = (refusal: Refusal) => <RefusalText refusal={refusal} />
