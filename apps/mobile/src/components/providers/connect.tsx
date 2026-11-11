import type { AiConnectionMethod } from '@rerun/analytics'
import { claudeTokenIssue, type AddableProvider, type AiConnectionsView, type ClaudeSignInStart, type CodexSignInStart } from '@rerun/contracts'
import * as Clipboard from 'expo-clipboard'
import * as WebBrowser from 'expo-web-browser'
import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'use-intl'

import { ApiError } from '@/api/client'
import { createAiConnection, finishClaudeSignIn, pollCodexSignIn, replaceAiConnectionKey, startClaudeSignIn, startCodexSignIn, updateAiConnection } from '@/api/aiConnections'
import { messageOf, useAiConnections } from '@/data/useAiConnections'
import { track } from '@/lib/analytics'
import * as Haptics from '@/lib/haptics'

import { ApiKeyForm } from './ApiKeyForm'
import { leave } from './routes'
import { ChatGptSignIn, ClaudeSignIn, type ChatGptPhase, type ClaudePhase, type SignInEnding } from './PlanSignIn'

// OpenAI refuses the code on its own page while the setting is off, and the app only ever sees the
// wait go on: past this, the wait is more likely that than a slow user.
const STUCK_AFTER_MS = 30_000

type Surface = 'add_provider' | 'reconnect'

function connected(provider: AddableProvider, method: AiConnectionMethod, surface: Surface) {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    track('ai_connection_connected', { provider, method, surface })
}

// Adding a plan ends on its name: the connection already exists, under the suggested one, once the
// sign-in lands. Signing one in again ends where it was opened from.
type Caller = ReturnType<typeof useAiConnections>['caller']

function useEnding(provider: AddableProvider, connectionId: string | null, reconnect: boolean, view: AiConnectionsView | null, caller: Caller): SignInEnding {
    const suggested = view?.addable.find(entry => entry.provider === provider)?.suggestedName ?? ''
    const [name, setName] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const t = useTranslations('mobileProviders.connect')
    if (reconnect) return { kind: 'reconnect' }

    const typed = name ?? suggested
    const done = async () => {
        if (!caller || !connectionId) return
        if (typed.trim() !== suggested) {
            setSaving(true)
            try {
                await updateAiConnection(caller, connectionId, { name: typed.trim() })
            } catch (err) {
                setSaving(false)
                setError(messageOf(err, t('renameFailed')))
                return
            }
        }
        leave()
    }
    return { kind: 'name', name: typed, placeholder: suggested, onName: setName, onDone: done, saving, error }
}

export function ClaudeConnect({ reconnectId }: { reconnectId: string | null }) {
    const { view, caller } = useAiConnections()
    const surface: Surface = reconnectId ? 'reconnect' : 'add_provider'
    const [pkce, setPkce] = useState<ClaudeSignInStart | null>(null)
    const [phase, setPhase] = useState<ClaudePhase>('idle')
    const [code, setCode] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [connectionId, setConnectionId] = useState<string | null>(null)
    const ending = useEnding('claude', connectionId, Boolean(reconnectId), view, caller)
    const t = useTranslations('mobileProviders.connect')
    const tClaude = useTranslations('mobileProviders.claude')

    const open = async () => {
        if (!caller) return
        setError(null)
        try {
            const start = await startClaudeSignIn(caller)
            setPkce(start)
            setPhase('waiting')
            await WebBrowser.openBrowserAsync(start.authorizeUrl)
        } catch {
            setError(t('startFailed'))
            track('ai_connection_failed', { provider: 'claude', method: 'oauth', surface, reason: 'start_failed' })
        }
    }

    // The code Claude shows can only be exchanged by the sign-in that asked for it; with none armed,
    // or for a `claude setup-token` token, the text is stored as a token.
    const submit = async (raw: string) => {
        const text = raw.trim()
        if (!text || !caller || phase === 'checking') return
        const asToken = text.startsWith('sk-ant') || !pkce
        if (asToken) {
            const issue = claudeTokenIssue(text)
            if (issue) {
                setError(tClaude(issue))
                track('ai_connection_failed', { provider: 'claude', method: 'token', surface, reason: 'invalid_token', error: issue })
                return
            }
        }
        setError(null)
        setPhase('checking')
        try {
            const id = asToken ? await storeToken(text) : await finishClaudeSignIn(caller, { code: text, ticket: pkce.ticket, connectionId: reconnectId ?? undefined })
            setCode('')
            setConnectionId(id)
            setPhase('connected')
            connected('claude', asToken ? 'token' : 'oauth', surface)
            if (reconnectId) leave()
        } catch (err) {
            const message = messageOf(err)
            setPhase(pkce ? 'waiting' : 'idle')
            setError(message)
            track('ai_connection_failed', { provider: 'claude', method: asToken ? 'token' : 'oauth', surface, reason: asToken ? 'rejected' : 'oauth_exchange_failed', error: message.slice(0, 200) })
        }
    }

    const storeToken = async (token: string) => {
        if (!caller) throw new Error(t('notSignedIn'))
        if (!reconnectId) return createAiConnection(caller, { provider: 'claude', apiKey: token })
        await replaceAiConnectionKey(caller, reconnectId, token)
        return reconnectId
    }

    const paste = async () => {
        const text = (await Clipboard.getStringAsync().catch(() => '')).trim()
        if (!text) return
        setCode(text)
        submit(text)
    }

    return <ClaudeSignIn phase={phase} error={error} code={code} onCode={setCode} onOpenClaude={open} onPaste={paste} onSubmit={() => submit(code)} ending={ending} onBack={() => leave()} />
}

export function ChatGptConnect({ reconnectId }: { reconnectId: string | null }) {
    const { view, caller } = useAiConnections()
    const surface: Surface = reconnectId ? 'reconnect' : 'add_provider'
    const [pending, setPending] = useState<CodexSignInStart | null>(null)
    const [starting, setStarting] = useState(false)
    const [connectionId, setConnectionId] = useState<string | null>(null)
    const [expired, setExpired] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [startedAt, setStartedAt] = useState(0)
    const [now, setNow] = useState(0)
    const ending = useEnding('codex', connectionId, Boolean(reconnectId), view, caller)
    const reconnectRef = useRef(reconnectId)
    const t = useTranslations('mobileProviders.connect')

    const getCode = async () => {
        if (!caller || starting) return
        setStarting(true)
        setError(null)
        setExpired(false)
        try {
            const next = await startCodexSignIn(caller)
            setPending(next)
            setStartedAt(Date.now())
            setNow(Date.now())
        } catch (err) {
            const message = messageOf(err, t('startFailed'))
            setError(message)
            track('ai_connection_failed', { provider: 'codex', method: 'oauth', surface, reason: 'start_failed', error: message.slice(0, 200) })
        } finally {
            setStarting(false)
        }
    }

    useEffect(() => {
        if (!pending) return
        const timer = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(timer)
    }, [pending])

    // Polled until the user approves, the code expires, or the screen goes. A poll that did not reach
    // the hub is tried again on the next tick, like a pending one.
    useEffect(() => {
        if (!pending || !caller) return
        let cancelled = false
        const timer = setInterval(async () => {
            if (Date.now() > pending.expiresAt) {
                clearInterval(timer)
                if (cancelled) return
                setPending(null)
                setExpired(true)
                track('ai_connection_failed', { provider: 'codex', method: 'oauth', surface, reason: 'code_expired' })
                return
            }
            let answer: Awaited<ReturnType<typeof pollCodexSignIn>>
            try {
                answer = await pollCodexSignIn(caller, { ticket: pending.ticket, connectionId: reconnectRef.current ?? undefined })
            } catch (err) {
                if (cancelled || !(err instanceof ApiError && err.status < 500)) return
                clearInterval(timer)
                setPending(null)
                setError(err.message)
                track('ai_connection_failed', { provider: 'codex', method: 'oauth', surface, reason: 'device_auth_failed', error: err.message.slice(0, 200) })
                return
            }
            if (cancelled || answer.status === 'pending') return
            clearInterval(timer)
            setPending(null)
            setConnectionId(answer.connectionId)
            connected('codex', 'oauth', surface)
            if (reconnectRef.current) leave()
        }, pending.pollIntervalMs)
        return () => {
            cancelled = true
            clearInterval(timer)
        }
    }, [pending, caller, surface])

    const phase: ChatGptPhase = connectionId ? 'connected' : pending ? 'waiting' : starting ? 'starting' : 'idle'
    const stuck = expired || (pending !== null && now - startedAt > STUCK_AFTER_MS)

    // The code is what the user types on OpenAI's page, so opening the page puts it on the clipboard.
    const shown = pending ? { userCode: pending.userCode, verificationUrl: pending.verificationUrl } : null
    return <ChatGptSignIn phase={phase} pending={shown} expired={expired} stuck={stuck} error={error} onGetCode={getCode} onOpenVerification={() => pending && Clipboard.setStringAsync(pending.userCode)} ending={ending} onBack={() => leave()} />
}

// `reconnectId` replaces the key of a connection its provider turned away rather than adding one.
export function ApiKeyConnect({ provider, reconnectId = null }: { provider: Exclude<AddableProvider, 'claude' | 'codex'>; reconnectId?: string | null }) {
    const { view, caller } = useAiConnections()
    const entry = view?.addable.find(candidate => candidate.provider === provider)
    const [name, setName] = useState<string | null>(null)
    const [apiKey, setApiKey] = useState('')
    const [baseUrl, setBaseUrl] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const t = useTranslations('mobileProviders.connect')
    if (!entry) return null

    const connect = async () => {
        if (!caller) return
        setBusy(true)
        setError(null)
        try {
            if (reconnectId) await replaceAiConnectionKey(caller, reconnectId, apiKey.trim())
            else await createAiConnection(caller, { provider, apiKey: apiKey.trim(), name: (name ?? entry.suggestedName).trim(), baseUrl: provider === 'openrouter' && baseUrl.trim() ? baseUrl.trim() : undefined })
            connected(provider, 'api_key', reconnectId ? 'reconnect' : 'add_provider')
            leave()
        } catch (err) {
            const message = messageOf(err, t('createFailed'))
            setError(message)
            track('ai_connection_failed', { provider, method: 'api_key', surface: reconnectId ? 'reconnect' : 'add_provider', reason: 'rejected', error: message.slice(0, 200) })
        } finally {
            setBusy(false)
        }
    }

    return <ApiKeyForm entry={entry} name={name ?? entry.suggestedName} onName={setName} apiKey={apiKey} onApiKey={setApiKey} baseUrl={baseUrl} onBaseUrl={setBaseUrl} busy={busy} error={error} onConnect={connect} onBack={() => leave()} />
}
