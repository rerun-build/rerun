import { useErrorText, type Refusal } from '@/hooks/useErrorText'
import { useTranslations } from 'next-intl'

// A full dotted key (`builder.boardToasts.addFailed`): the catalog is too large a union to type it.
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

// For a toast raised outside any component (a store, a plain async helper): the sentence is written
// when the toast renders, in the reader's language.
export const translated = (id: MessageKey, values?: MessageValues) => <TranslatedText id={id} values={values} />

export const refusalText = (refusal: Refusal) => <RefusalText refusal={refusal} />
