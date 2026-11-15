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
const TURNSTILE_SILENT_TIMEOUT_MS = HCAPTCHA_SITE_KEY ? 8_000 : 20_000
const HCAPTCHA_SCRIPT_TIMEOUT_MS = 20_000

function appendSlot(container: HTMLElement): HTMLDivElement {
    const slot = document.createElement('div')
    container.appendChild(slot)
    return slot
}

export function useCaptcha() {
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
        if (!container) return
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
    }, [])

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
            if (ask === puzzleAsk.current) {
                slot.hidden = true
                setPuzzleShown(false)
            }
        }
    }, [resolvedTheme])

    const getToken = useCallback<GetCaptchaToken>(async () => {
        if (!TURNSTILE_SITE_KEY && !HCAPTCHA_SITE_KEY) return undefined
        if (TURNSTILE_SITE_KEY && !turnstileFailed.current) {
            try {
                if (!turnstile.current) throw new CaptchaError('turnstile', 'captcha_failed', 'unmounted')
                return { provider: 'turnstile', token: await turnstile.current.widget.getToken() }
            } catch (error) {
                if (!HCAPTCHA_SITE_KEY || !containerRef.current || (error instanceof CaptchaError && error.superseded)) throw error
                turnstileFailed.current = true
                turnstile.current?.widget.remove()
                turnstile.current?.slot.remove()
                turnstile.current = null
                setTurnstileInteractive(false)
                track('captcha_puzzle_shown', error instanceof CaptchaError ? { turnstile_reason: error.reason, turnstile_code: error.code } : {})
            }
        }
        return { provider: 'hcaptcha', token: await solvePuzzle() }
    }, [solvePuzzle])

    return { containerRef, challenging: turnstileInteractive || puzzleShown, getToken }
}
