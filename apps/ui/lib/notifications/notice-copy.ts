import type { Json } from '@/app/api/database.types'
import type { Messages } from '@rerun/i18n/messages'

// A notice the hub writes itself (an app slot paused, the credits used up) carries its sentence as a
// key of `notifications.notices` with its values, so each member reads it in their own language.
// `message` keeps the English, for the screens that predate the key.
export type NoticeKey = keyof Messages['notifications']['notices']
export type NoticeCopy = { key: NoticeKey; values?: Record<string, string | number> }

type NoticeTranslator = { (key: NoticeKey, values?: Record<string, string | number | Date>): string; has(key: string): boolean }

function noticeCopyOf(metadata: Json | null): NoticeCopy | null {
    const notice = (metadata as { notice?: unknown } | null)?.notice as Partial<NoticeCopy> | undefined
    return notice && typeof notice.key === 'string' ? { key: notice.key, values: notice.values } : null
}

// A value named `...At` is a date written as ISO: the sentence formats it in the reader's language.
function withDates(values: Record<string, string | number> = {}): Record<string, string | number | Date> {
    return Object.fromEntries(Object.entries(values).map(([name, value]) => [name, name.endsWith('At') && typeof value === 'string' ? new Date(value) : value]))
}

export function noticeText(row: { message: string; metadata: Json | null }, t: NoticeTranslator): string {
    const copy = noticeCopyOf(row.metadata)
    return copy && t.has(copy.key) ? t(copy.key, withDates(copy.values)) : row.message
}
