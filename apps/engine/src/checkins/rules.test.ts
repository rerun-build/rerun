import { describe, expect, it } from 'vitest'
import type { CheckinDigest } from '@rerun/contracts'
import { decide } from './rules.js'

const now = Date.parse('2026-11-19T09:30:00.000Z')
const HOUR = 60 * 60_000

const calm: CheckinDigest = { workspaceAgeDays: 40, daysSinceLastCheckin: 2, daysSinceLastHumanMessage: 1, coworkers: 3, failedRuns24h: 0, failingCoworkers: [], pendingQuestions: 0, appsNeedingSignIn: 0, inactiveCoworkers: [], openSkillProposals: 0, neverUsed: [] }
const at = (digest: Partial<CheckinDigest>, lastCheckinAt: number | null = now - 48 * HOUR) => decide({ digest: { ...calm, ...digest }, lastCheckinAt, now })

describe('decide', () => {
    it('leaves alone a workspace nobody wrote in, or nobody for thirty days', () => {
        expect(at({ daysSinceLastHumanMessage: null, workspaceAgeDays: 1 })).toBe('skip')
        expect(at({ daysSinceLastHumanMessage: 30, failedRuns24h: 9 })).toBe('skip')
        expect(at({ daysSinceLastHumanMessage: 29, failedRuns24h: 9 })).toBe('checkin')
    })

    it('never checks in twice within twenty hours, whatever is broken', () => {
        expect(at({ failedRuns24h: 9, workspaceAgeDays: 2 }, now - 19 * HOUR)).toBe('skip')
        expect(at({ failedRuns24h: 9 }, now - 21 * HOUR)).toBe('checkin')
    })

    it('checks in every day of the first two weeks', () => {
        expect(at({ workspaceAgeDays: 0 }, null)).toBe('checkin')
        expect(at({ workspaceAgeDays: 13 })).toBe('checkin')
        expect(at({ workspaceAgeDays: 14 })).toBe('skip')
    })

    it('checks in when something is broken or waits on a person', () => {
        expect(at({ failedRuns24h: 3 })).toBe('checkin')
        expect(at({ pendingQuestions: 1 })).toBe('checkin')
        expect(at({ appsNeedingSignIn: 1 })).toBe('checkin')
    })

    it('checks in at least once a week, and on the first pulse ever', () => {
        expect(at({ daysSinceLastCheckin: 7 })).toBe('checkin')
        expect(at({ daysSinceLastCheckin: null }, null)).toBe('checkin')
    })

    it('asks the triage about something minor, and stays quiet when there is nothing', () => {
        for (const minor of [{ failedRuns24h: 1 }, { inactiveCoworkers: ['SEO watcher'] }, { openSkillProposals: 2 }, { neverUsed: ['company_brain' as const] }]) expect(at(minor)).toBe('ask')
        expect(at({})).toBe('skip')
    })
})
