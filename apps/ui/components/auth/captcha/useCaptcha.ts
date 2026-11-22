'use client'

import { CaptchaError, type GetCaptchaToken } from '@/components/auth/captcha/captcha-error'
import type { CaptchaWidget } from '@/components/auth/captcha/captcha-widget'
import { mountHcaptcha } from '@/components/auth/captcha/hcaptcha-widget'
import { mountTurnstile } from '@/components/auth/captcha/turnstile-widget'
import { track } from '@rerun/analytics/client'
import { useTheme } from 'next-themes'
import { useCallback, useEffect, useRef, useState } from 'react'

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
const HCAPTCHA_SITE_KEY = process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY
// Cloudflare answers in a second or two when it draws nothing. With a puzzle behind, the visitor is
// handed it quickly instead of waiting on a spinning button; without one, the wait stays as long as
// it was before the puzzle existed, since past it there is only an error.
const TURNSTILE_SILENT_TIMEOUT_MS = HCAPTCHA_SITE_KEY ? 8_000 : 20_000
// Only the loading of the puzzle's script is timed: past it there is only an error, so the wait is
// the one of the dead end above.
const HCAPTCHA_SCRIPT_TIMEOUT_MS = 20_000

function appendSlot(container: HTMLElement): HTMLDivElement {
    const slot = document.createElement('div')
    container.appendChild(slot)
    return slot
}

// The robot check of every form that sends a code. Cloudflare's invisible check comes first; when
// it fails or stays silent, the visitor is handed an hCaptcha puzzle instead of an error, and keeps
// it for the next sends of this form, since Cloudflare would most likely turn them away again.
// The puzzle's script is only fetched for those visitors. Without any site key, as on a local
// stack, there is no check at all. `skipped` comes from the page, which read in the request a
// header this JavaScript never sees (Tella Auto Capture, which cannot solve a captcha).
export function useCaptcha({ skipped = false }: { skipped?: boolean } = {}) {
    const containerRef = useRef<HTMLDivElement>(null)
    const turnstile = useRef<{ widget: CaptchaWidget; slot: HTMLDivElement } | null>(null)
    const puzzle = useRef<{ widget: CaptchaWidget; slot: HTMLDivElement } | null>(null)
    const turnstileFailed = useRef(false)
    const puzzleAsk = useRef(0)
    const [turnstileInteractive, setTurnstileInteractive] = useState(false)
    const [puzzleShown, setPuzzleShown] = useState(false)
    const { resolvedTheme } = useTheme()

    useEffect(() => {
        const container = containerRef.current
        if (!container || skipped) return
        if (TURNSTILE_SITE_KEY) {
            const slot = appendSlot(container)
            turnstile.current = { slot, widget: mountTurnstile(slot, TURNSTILE_SITE_KEY, setTurnstileInteractive, TURNSTILE_SILENT_TIMEOUT_MS) }
        }
        return () => {
            turnstile.current?.widget.remove()
            turnstile.current?.slot.remove()
            turnstile.current = null
            puzzle.current?.widget.remove()
            puzzle.current?.slot.remove()
            puzzle.current = null
        }
    }, [skipped])

    const solvePuzzle = useCallback(async (): Promise<string> => {
        const container = containerRef.current
        if (!HCAPTCHA_SITE_KEY || !container) throw new CaptchaError('hcaptcha', 'captcha_failed', 'unmounted')
        if (!puzzle.current) {
            const slot = appendSlot(container)
            puzzle.current = { slot, widget: mountHcaptcha(slot, HCAPTCHA_SITE_KEY, resolvedTheme === 'dark' ? 'dark' : 'light', HCAPTCHA_SCRIPT_TIMEOUT_MS) }
        }
        const { slot, widget } = puzzle.current
        const ask = ++puzzleAsk.current
        slot.hidden = false
        setPuzzleShown(true)
        try {
            const token = await widget.getToken()
            track('captcha_puzzle_solved', {})
            return token
        } finally {
            // A newer send that took over this wait keeps the puzzle on screen.
            if (ask === puzzleAsk.current) {
                slot.hidden = true
                setPuzzleShown(false)
            }
        }
    }, [resolvedTheme])

    const getToken = useCallback<GetCaptchaToken>(async () => {
        if (skipped || (!TURNSTILE_SITE_KEY && !HCAPTCHA_SITE_KEY)) return undefined
        if (TURNSTILE_SITE_KEY && !turnstileFailed.current) {
            try {
                if (!turnstile.current) throw new CaptchaError('turnstile', 'captcha_failed', 'unmounted')
                return { provider: 'turnstile', token: await turnstile.current.widget.getToken() }
            } catch (error) {
                if (!HCAPTCHA_SITE_KEY || !containerRef.current || (error instanceof CaptchaError && error.superseded)) throw error
                // Cloudflare would keep retrying, and drawing its failure, beside the puzzle.
                turnstileFailed.current = true
                turnstile.current?.widget.remove()
                turnstile.current?.slot.remove()
                turnstile.current = null
                setTurnstileInteractive(false)
                track('captcha_puzzle_shown', error instanceof CaptchaError ? { turnstile_reason: error.reason, turnstile_code: error.code } : {})
            }
        }
        return { provider: 'hcaptcha', token: await solvePuzzle() }
    }, [skipped, solvePuzzle])

    return { containerRef, challenging: turnstileInteractive || puzzleShown, getToken }
}
