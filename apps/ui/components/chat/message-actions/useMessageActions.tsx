'use client'

import { counterpartIn, editableTextOf, engineMessageIdOf, messageEditRefusalOf, messageLinkOf, messageText, replyBounds, userIndexBefore } from '@rerun/contracts'
import { generateId, type UIMessage } from 'ai'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactElement, type ReactNode, type RefObject } from 'react'
import { toast } from 'sonner'

import { deleteConversationMessageAction, fetchSessionMessages, messageEditsAvailableAction } from '@/app/api/_actions/session.actions'
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog'
import { useErrorText } from '@/hooks/useErrorText'
import { actionForKey, isSelectableMessage, keepsMessageSelection, type MessageAction } from '@/lib/chat/message-actions'
import { historyCovers } from '@/lib/chat/transcript-reconcile'
import { isTypingTarget } from '@/lib/typing-target'

import { InlineMessageEditor } from './InlineMessageEditor'
import { messageActionItems } from './message-action-items'
import { SelectableMessage } from './SelectableMessage'

type ReplayOptions = { body: { replaceFrom: string } }

type MessageActionsOptions = {
    active: boolean
    agentId: string
    agentName: string
    sessionId: string | null
    messages: UIMessage[]
    setMessages: (messages: UIMessage[]) => void
    // Sends the last message of the user again, in place of everything from `replaceFrom` on.
    replay: (options: ReplayOptions) => void
    // A reply is being written: nothing may change under it.
    busy: boolean
    rootRef: RefObject<HTMLElement | null>
    // Lets go of the conversation's follow of its end: the bar the selection opens grows the
    // conversation, which would otherwise scroll it back to the bottom, away from the message.
    stopFollowing: () => void
    inputRef: RefObject<HTMLTextAreaElement | null>
    // A link to a message opened the conversation: that message is selected once it is on screen.
    focusMessageId?: string
    arrival: number
    // The error of the chat's last send: a replacement the hub refused leaves the screen cut short.
    error: Error | undefined
    clearError: () => void
}

// Parsing the markers of every message on every streamed chunk adds up; a message object only
// changes while it is the one being written.
const selectableCache = new WeakMap<object, boolean>()
function selectable(message: UIMessage): boolean {
    const cached = selectableCache.get(message)
    if (cached !== undefined) return cached
    const result = isSelectableMessage(message)
    selectableCache.set(message, result)
    return result
}

// How long the selected message takes to let go: the bar folds away while the highlight fades.
const RELEASE_MS = 200

function rowOf(root: HTMLElement | null, messageId: string): HTMLElement | null {
    return root?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(messageId)}"]`) ?? null
}

export function useMessageActions({ active, agentId, agentName, sessionId, messages, setMessages, replay, busy, rootRef, stopFollowing, inputRef, focusMessageId, arrival, error, clearError }: MessageActionsOptions) {
    const t = useTranslations('chat.messageActions')
    const errorText = useErrorText()
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [deletingId, setDeletingId] = useState<string | null>(null)
    const [deleting, setDeleting] = useState(false)
    const messagesRef = useRef(messages)
    useEffect(() => {
        messagesRef.current = messages
    })

    const [shownSessionId, setShownSessionId] = useState(sessionId)
    if (shownSessionId !== sessionId) {
        setShownSessionId(sessionId)
        setSelectedId(null)
        setEditingId(null)
    }

    const selectableIds = useMemo(() => messages.filter(selectable).map(message => message.id), [messages])

    // A message streamed in this tab keeps the id the SDK gave it until the history is read again:
    // the history is read then, put on screen, and the message found in it by its turn.
    const withEngineIds = useCallback(
        async (messageId: string): Promise<{ list: UIMessage[]; id: string } | null> => {
            const live = messagesRef.current
            const index = live.findIndex(message => message.id === messageId)
            if (index < 0) return null
            if (engineMessageIdOf(messageId)) return { list: live, id: messageId }
            if (!sessionId) return null
            const history = (await fetchSessionMessages(sessionId).catch(() => [])) as UIMessage[]
            if (!historyCovers(live, history)) return null
            const id = counterpartIn(live, index, history)
            if (!id) return null
            setMessages(history)
            setSelectedId(current => (current === messageId ? id : current))
            return { list: history, id }
        },
        [sessionId, setMessages]
    )

    const editsChecked = useRef<{ sessionId: string; available: boolean } | null>(null)
    const machineTakesEdits = useCallback(async () => {
        if (!sessionId) return false
        if (editsChecked.current?.sessionId === sessionId) return editsChecked.current.available
        const available = await messageEditsAvailableAction(sessionId)
        if (available !== null) editsChecked.current = { sessionId, available }
        if (available === false) toast.error(t('engineOutdated'))
        return available !== false
    }, [sessionId, t])

    // The message of the user at `userId` and everything after it give way to `text`.
    const replayFrom = useCallback(
        async (userId: string, text?: string) => {
            if (!(await machineTakesEdits())) return
            const resolved = await withEngineIds(userId)
            const at = resolved ? resolved.list.findIndex(message => message.id === resolved.id) : -1
            const engineId = resolved ? engineMessageIdOf(resolved.id) : null
            if (!resolved || at < 0 || !engineId) return void toast.error(t('notReady'))
            // The engine writes the message again under a new row: the id of the old one must not stay on it.
            const original = resolved.list[at]
            const kept = { ...original, id: generateId(), ...(text !== undefined && { parts: [{ type: 'text' as const, text }] }) }
            setMessages([...resolved.list.slice(0, at), kept])
            setSelectedId(null)
            replay({ body: { replaceFrom: resolved.id } })
        },
        [machineTakesEdits, withEngineIds, setMessages, replay, t]
    )

    // The screen dropped the message and what followed before the hub answered; the machine kept them.
    // Its copy comes back, without the error and its Retry, which would only append the new text.
    useEffect(() => {
        const refusal = error ? messageEditRefusalOf(error.message) : null
        if (!refusal) return
        clearError()
        toast.error(t(refusal === 'engineOutdated' ? 'engineOutdated' : 'failed'))
        if (!sessionId) return
        void fetchSessionMessages(sessionId).then(history => {
            if (history.length > 0) setMessages(history as UIMessage[])
        })
    }, [error, clearError, sessionId, setMessages, t])

    const regenerateReply = useCallback(
        (messageId: string) => {
            const list = messagesRef.current
            const userAt = userIndexBefore(list, list.findIndex(message => message.id === messageId))
            if (userAt >= 0) void replayFrom(list[userAt].id)
        },
        [replayFrom]
    )

    const saveEdit = useCallback(
        (messageId: string, edited: string) => {
            const message = messagesRef.current.find(item => item.id === messageId)
            const editable = message ? editableTextOf(message) : null
            setEditingId(null)
            if (editable) void replayFrom(messageId, editable.rebuild(edited))
        },
        [replayFrom]
    )

    const copyLink = useCallback(
        async (messageId: string) => {
            const resolved = await withEngineIds(messageId)
            if (!resolved || !sessionId) return void toast.error(t('notReady'))
            const url = messageLinkOf(window.location.origin, { agentId, sessionId, messageId: resolved.id })
            await navigator.clipboard.writeText(url)
            toast.success(t('linkCopied'), { description: url })
        },
        [withEngineIds, sessionId, agentId, t]
    )

    const run = useCallback(
        (action: MessageAction, message: UIMessage) => {
            const changing = action === 'edit' || action === 'regenerate' || action === 'delete'
            if (changing && busy) return
            if (action === 'edit' && message.role === 'user' && editableTextOf(message)) {
                setEditingId(message.id)
                setSelectedId(null)
            }
            if (action === 'regenerate' && message.role === 'assistant') regenerateReply(message.id)
            if (action === 'copy') {
                const text = editableTextOf(message)?.text ?? messageText(message)
                void navigator.clipboard.writeText(text).then(() => toast.success(t('copied')))
            }
            if (action === 'link') void copyLink(message.id)
            if (action === 'delete') setDeletingId(message.id)
        },
        [busy, regenerateReply, copyLink, t]
    )

    const confirmDelete = useCallback(async () => {
        if (!deletingId || !sessionId) return
        setDeleting(true)
        try {
            const resolved = await withEngineIds(deletingId)
            if (!resolved) return void toast.error(t('notReady'))
            const result = await deleteConversationMessageAction(sessionId, resolved.id)
            if (!result.ok) return void toast.error(errorText(result))
            const list = messagesRef.current
            const at = list.findIndex(message => message.id === resolved.id)
            if (at >= 0) {
                const { start, end } = list[at].role === 'user' ? { start: at, end: at + 1 } : replyBounds(list, at)
                const rest = [...list.slice(0, start), ...list.slice(end)]
                setMessages(rest)
                const next = rest.slice(start).find(selectable) ?? rest.slice(0, start).findLast(selectable)
                setSelectedId(next?.id ?? null)
            }
            toast(t('deleted'))
        } finally {
            setDeleting(false)
            setDeletingId(null)
        }
    }, [deletingId, sessionId, withEngineIds, errorText, setMessages, t])

    const [leavingId, setLeavingId] = useState<string | null>(null)
    const leavingTimer = useRef<number | undefined>(undefined)
    useEffect(() => () => window.clearTimeout(leavingTimer.current), [])

    const release = useCallback(() => {
        if (!selectedId) return
        window.clearTimeout(leavingTimer.current)
        setLeavingId(selectedId)
        setSelectedId(null)
        leavingTimer.current = window.setTimeout(() => setLeavingId(null), RELEASE_MS)
    }, [selectedId])

    const select = useCallback(
        (messageId: string | null) => {
            window.clearTimeout(leavingTimer.current)
            setLeavingId(null)
            setSelectedId(messageId)
            if (!messageId) return
            stopFollowing()
            requestAnimationFrame(() => rowOf(rootRef.current, messageId)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
        },
        [rootRef, stopFollowing]
    )

    // ↑ in an empty composer reaches the messages; the other keys only act once one is selected, or
    // from inside this chat.
    const onComposerKeyDown = useCallback(
        (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
            if (event.defaultPrevented || event.key !== 'ArrowUp' || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return
            if (event.currentTarget.value.trim() || selectableIds.length === 0) return
            event.preventDefault()
            event.currentTarget.blur()
            select(selectableIds[selectableIds.length - 1])
        },
        [selectableIds, select]
    )

    useEffect(() => {
        if (!active || editingId || deletingId) return
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
            const target = event.target as HTMLElement | null
            if (isTypingTarget(target) || target?.closest('[role="menu"], [role="dialog"], [role="alertdialog"], [role="listbox"]')) return
            const index = selectedId ? selectableIds.indexOf(selectedId) : -1
            const insideChat = !!target && !!rootRef.current?.contains(target)
            if (index < 0 && !insideChat) return
            const handled = () => {
                event.preventDefault()
                event.stopPropagation()
            }
            if (event.key === 'ArrowUp') {
                if (selectableIds.length === 0) return
                handled()
                return select(selectableIds[index < 0 ? selectableIds.length - 1 : Math.max(0, index - 1)])
            }
            if (event.key === 'ArrowDown') {
                if (index < 0) return
                handled()
                if (index < selectableIds.length - 1) return select(selectableIds[index + 1])
                release()
                inputRef.current?.focus()
                return
            }
            if (index < 0) return
            if (event.key === 'Escape') {
                handled()
                return release()
            }
            const action = actionForKey(event.key)
            const message = messagesRef.current.find(item => item.id === selectedId)
            if (!action || !message) return
            if (action === 'edit' && message.role !== 'user') return
            if (action === 'regenerate' && message.role !== 'assistant') return
            handled()
            run(action, message)
        }
        window.addEventListener('keydown', onKeyDown, true)
        return () => window.removeEventListener('keydown', onKeyDown, true)
    }, [active, editingId, deletingId, selectedId, selectableIds, rootRef, inputRef, select, release, run])

    useEffect(() => {
        if (!active || !selectedId || editingId || deletingId) return
        // Folding the bar while the button is still down would lift what is under it and drop its click.
        let releaseOnUp = false
        const onPointerDown = (event: PointerEvent) => {
            if (event.button !== 0 || !(event.target instanceof Element)) return
            releaseOnUp = !keepsMessageSelection(event.target, rootRef.current)
        }
        const onPointerUp = () => {
            if (!releaseOnUp) return
            releaseOnUp = false
            release()
        }
        document.addEventListener('pointerdown', onPointerDown, true)
        document.addEventListener('pointerup', onPointerUp, true)
        document.addEventListener('pointercancel', onPointerUp, true)
        return () => {
            document.removeEventListener('pointerdown', onPointerDown, true)
            document.removeEventListener('pointerup', onPointerUp, true)
            document.removeEventListener('pointercancel', onPointerUp, true)
        }
    }, [active, selectedId, editingId, deletingId, rootRef, release])

    // Once per arrival from a link: the history may land after the conversation opened.
    const [focusedArrival, setFocusedArrival] = useState(0)
    const [linkedId, setLinkedId] = useState<string | null>(null)
    if (active && focusMessageId && focusedArrival !== arrival && messages.some(message => message.id === focusMessageId)) {
        setFocusedArrival(arrival)
        setSelectedId(focusMessageId)
        setLinkedId(focusMessageId)
    }
    useEffect(() => {
        if (!linkedId) return
        stopFollowing()
        requestAnimationFrame(() => rowOf(rootRef.current, linkedId)?.scrollIntoView({ block: 'center' }))
    }, [linkedId, focusedArrival, rootRef, stopFollowing])

    const changeBlockedReason = busy ? t('busy') : undefined

    const wrap = (message: UIMessage, view: ReactElement): ReactNode => {
        if (!selectable(message)) return view
        if (editingId === message.id) {
            const editable = editableTextOf(message)
            if (editable) return <InlineMessageEditor key={message.id} initial={editable.text} onSave={text => saveEdit(message.id, text)} onCancel={() => setEditingId(null)} />
        }
        const isUser = message.role === 'user'
        const items = messageActionItems({ isUser, changeBlockedReason, editBlockedReason: isUser && !editableTextOf(message) ? t('voiceNotEditable') : undefined })
        return (
            <SelectableMessage key={message.id} messageId={message.id} isUser={isUser} selected={selectedId === message.id} leaving={leavingId === message.id} items={items} onSelect={() => (selectedId === message.id ? release() : select(message.id))} onAction={action => run(action, message)}>
                {view}
            </SelectableMessage>
        )
    }

    const deletingMessage = messages.find(message => message.id === deletingId)
    const dialog = (
        <ConfirmDialog
            open={!!deletingMessage}
            onOpenChange={open => {
                if (!open && !deleting) setDeletingId(null)
            }}
            title={t('deleteTitle')}
            description={deletingMessage?.role === 'user' ? t('deleteUserDescription', { name: agentName }) : t('deleteReplyDescription', { name: agentName })}
            confirmLabel={t('delete')}
            pending={deleting}
            onConfirm={event => {
                event.preventDefault()
                void confirmDelete()
            }}
        />
    )

    return { selectedId, wrap, dialog, onComposerKeyDown, regenerateReply }
}
