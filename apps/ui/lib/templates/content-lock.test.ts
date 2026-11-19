import { describe, expect, it, vi } from 'vitest'

import { isTemplateContentLocked, lockedPlaceholder, templateLockTooltip } from './content-lock'
vi.mock('@moldwright/cloud/billing', async importOriginal => ({ ...(await importOriginal<object>()), ...(await import('@/test/cloud-fakes')).CLOUD_ENTITLEMENTS }))

const FROM_TEMPLATE = { templateId: 'tpl_1' }

describe('isTemplateContentLocked', () => {
    it('never locks an agent that did not come from a template', () => {
        expect(isTemplateContentLocked({ templateId: null }, { subscription_status: 'trialing', is_sandbox: false })).toBe(false)
    })

    it('never locks a sandbox', () => {
        expect(isTemplateContentLocked(FROM_TEMPLATE, { subscription_status: null, is_sandbox: true })).toBe(false)
    })

    it.each([['active'], ['past_due']])('unlocks a %s workspace', status => {
        expect(isTemplateContentLocked(FROM_TEMPLATE, { subscription_status: status, is_sandbox: false })).toBe(false)
    })

    it.each([['trialing'], ['canceled'], [null]])('locks a %s workspace', status => {
        expect(isTemplateContentLocked(FROM_TEMPLATE, { subscription_status: status, is_sandbox: false })).toBe(true)
    })

    it('locks when the workspace is unknown', () => {
        expect(isTemplateContentLocked(FROM_TEMPLATE, null)).toBe(true)
        expect(isTemplateContentLocked(FROM_TEMPLATE, undefined)).toBe(true)
    })
})

describe('templateLockTooltip', () => {
    it('puts the action at the head of the sentence', () => {
        expect(templateLockTooltip('Downloading this skill')).toBe('Downloading this skill unlocks once your workspace is on a paid plan.')
    })
})

describe('lockedPlaceholder', () => {
    it('opens with the heading of its kind', () => {
        expect(lockedPlaceholder('skill', 10).startsWith('# Procedure\n\n')).toBe(true)
        expect(lockedPlaceholder('soul', 10).startsWith('# System prompt\n\n')).toBe(true)
        expect(lockedPlaceholder('schedule', 10).startsWith('# Task prompt\n\n')).toBe(true)
        expect(lockedPlaceholder('trigger', 10).startsWith('# Webhook prompt\n\n')).toBe(true)
        expect(lockedPlaceholder('file', 10).startsWith('# Reference\n\n')).toBe(true)
    })

    it('gives every short text the same 400 character floor', () => {
        expect(lockedPlaceholder('skill', 0)).toBe(lockedPlaceholder('skill', 399))
        expect(lockedPlaceholder('skill', 0)).toBe(lockedPlaceholder('skill', 400))
        expect(lockedPlaceholder('skill', 0).length).toBeGreaterThanOrEqual(400)
    })

    it('rounds lengths up to the next 400 step so sizes within a step look alike', () => {
        expect(lockedPlaceholder('skill', 401)).toBe(lockedPlaceholder('skill', 800))
        expect(lockedPlaceholder('skill', 401)).not.toBe(lockedPlaceholder('skill', 400))
        expect(lockedPlaceholder('skill', 801).length).toBeGreaterThan(lockedPlaceholder('skill', 800).length)
    })

    it('caps the placeholder at the 2000 character bucket', () => {
        expect(lockedPlaceholder('skill', 50_000)).toBe(lockedPlaceholder('skill', 1601))
        expect(lockedPlaceholder('skill', 50_000).length).toBeLessThan(2200)
    })

    it('never carries anything but filler', () => {
        const body = lockedPlaceholder('soul', 1200).split('\n').slice(2).filter(Boolean)
        expect(body.every(line => /^(Lorem|Ut enim|Duis|Excepteur)/.test(line))).toBe(true)
    })
})
