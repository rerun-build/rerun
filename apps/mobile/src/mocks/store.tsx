import { createContext, use, useRef, useState, type ReactNode } from 'react'

import { CANNED_REPLIES, coworkers as seedCoworkers, mockTitle, orderCoworkers, sessions as seedSessions, type Coworker, type Message, type Session } from './data'
import { workspaces } from './workspaces'

const WAKE_MS = 1400
const THINK_MS = 1200
const WORK_MS = 2600
const TITLE_MS = 1500

type Outgoing = { text: string; images?: string[] }

type Store = {
    coworkers: Coworker[]
    workspaceId: string
    coworker: (id: string) => Coworker | undefined
    session: (id: string) => Session | undefined
    sessionsOf: (coworkerId: string) => Session[]
    latestSession: (coworkerId: string) => Session | undefined
    createSession: (coworkerId: string, first?: Outgoing) => string
    send: (sessionId: string, message: Outgoing) => void
    stop: (sessionId: string) => void
    setModel: (coworkerId: string, modelId: string) => void
    switchWorkspace: (id: string) => void
    markRead: (coworkerId: string) => void
}

const StoreContext = createContext<Store | null>(null)

export function MockStore({ children }: { children: ReactNode }) {
    const [coworkerList, setCoworkers] = useState(seedCoworkers)
    const [sessionList, setSessions] = useState(seedSessions)
    const [workspaceId, setWorkspaceId] = useState(workspaces[0].id)
    const timers = useRef(new Map<string, ReturnType<typeof setTimeout>[]>())
    const replies = useRef(0)

    const updateSession = (id: string, change: (session: Session) => Session) => setSessions(current => current.map(session => (session.id === id ? change(session) : session)))
    const updateCoworker = (id: string, change: (coworker: Coworker) => Coworker) => setCoworkers(current => current.map(coworker => (coworker.id === id ? change(coworker) : coworker)))

    const later = (sessionId: string, delay: number, action: () => void) => {
        const timer = setTimeout(action, delay)
        timers.current.set(sessionId, [...(timers.current.get(sessionId) ?? []), timer])
    }

    const clearTimers = (sessionId: string) => {
        timers.current.get(sessionId)?.forEach(clearTimeout)
        timers.current.delete(sessionId)
    }

    const run = (sessionId: string, coworkerId: string, outgoing: Outgoing, { first, running }: { first: boolean; running: boolean }) => {
        const message: Message = { id: `u${Date.now()}`, role: 'user', text: outgoing.text, images: outgoing.images }
        const asleep = coworkerList.find(coworker => coworker.id === coworkerId)?.status === 'offline'
        updateSession(sessionId, session => ({ ...session, pendingQuestion: undefined, updatedMinutesAgo: 0, messages: [...session.messages, message], run: running ? session.run : { phase: asleep ? 'waking' : 'thinking', startedAt: Date.now() } }))
        updateCoworker(coworkerId, coworker => ({ ...coworker, status: 'working', updatedMinutesAgo: 0 }))
        if (first) setTimeout(() => updateSession(sessionId, session => ({ ...session, title: session.title ?? mockTitle(outgoing.text) })), TITLE_MS)
        if (running) return

        const thinkAt = asleep ? WAKE_MS : 0
        if (asleep) later(sessionId, WAKE_MS, () => updateSession(sessionId, session => (session.run ? { ...session, run: { ...session.run, phase: 'thinking' } } : session)))
        later(sessionId, thinkAt + THINK_MS, () => updateSession(sessionId, session => (session.run ? { ...session, run: { ...session.run, phase: 'working' } } : session)))
        later(sessionId, thinkAt + THINK_MS + WORK_MS, () => {
            const reply = CANNED_REPLIES[replies.current++ % CANNED_REPLIES.length]
            updateSession(sessionId, session => ({ ...session, run: undefined, messages: [...session.messages, { id: `a${Date.now()}`, role: 'assistant', text: reply }] }))
            updateCoworker(coworkerId, coworker => ({ ...coworker, status: 'idle' }))
            timers.current.delete(sessionId)
        })
    }

    const byRecency = (a: Session, b: Session) => a.updatedMinutesAgo - b.updatedMinutesAgo

    const store: Store = {
        coworkers: orderCoworkers(coworkerList),
        workspaceId,
        coworker: id => coworkerList.find(coworker => coworker.id === id),
        session: id => sessionList.find(session => session.id === id),
        sessionsOf: coworkerId => sessionList.filter(session => session.coworkerId === coworkerId).sort(byRecency),
        latestSession: coworkerId => sessionList.filter(session => session.coworkerId === coworkerId).sort(byRecency)[0],
        createSession(coworkerId, first) {
            const id = `s${Date.now()}`
            setSessions(current => [{ id, coworkerId, title: null, messages: [], updatedMinutesAgo: 0 }, ...current])
            if (first) run(id, coworkerId, first, { first: true, running: false })
            return id
        },
        send(sessionId, outgoing) {
            const session = sessionList.find(entry => entry.id === sessionId)
            if (!session) return
            run(sessionId, session.coworkerId, outgoing, { first: !session.title && session.messages.length === 0, running: Boolean(session.run) })
        },
        stop(sessionId) {
            const session = sessionList.find(entry => entry.id === sessionId)
            clearTimers(sessionId)
            updateSession(sessionId, entry => ({ ...entry, run: undefined }))
            if (session) updateCoworker(session.coworkerId, coworker => ({ ...coworker, status: 'idle' }))
        },
        setModel(coworkerId, modelId) {
            updateCoworker(coworkerId, coworker => ({ ...coworker, modelId }))
        },
        switchWorkspace: setWorkspaceId,
        markRead(coworkerId) {
            setCoworkers(current => (current.some(coworker => coworker.id === coworkerId && coworker.unread) ? current.map(coworker => (coworker.id === coworkerId ? { ...coworker, unread: false } : coworker)) : current))
        },
    }

    return <StoreContext value={store}>{children}</StoreContext>
}

export function useStore() {
    const store = use(StoreContext)
    if (!store) throw new Error('useStore needs a <MockStore>')
    return store
}
