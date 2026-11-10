import { describe, expect, it } from 'vitest'
import { getToolMeta, isKnownTool } from './tool-meta'
import { englishTranslator } from '@/lib/i18n/english-translator'
import { BookOpenIcon, CoinsIcon, MailIcon } from '@/lib/icons'

const t = englishTranslator('tools')

describe('getToolMeta', () => {
    it('falls back to a plain paid data row when the capability is unknown or missing', () => {
        expect(getToolMeta('paid_data', { capability: 'tiktok.followers' }, t)).toEqual({ label: 'Paid data', icon: CoinsIcon })
        expect(getToolMeta('paid_data', undefined, t)).toEqual({ label: 'Paid data', icon: CoinsIcon })
    })

    it('shows a catalog read as a read, never as a purchase', () => {
        expect(getToolMeta('paid_data_catalog', { group: 'tiktok' }, t)).toEqual({ label: 'Paid data catalog', icon: BookOpenIcon })
        expect(isKnownTool('paid_data_catalog')).toBe(true)
        expect(getToolMeta('paid_data_read', { saved: '.rerun/paid-data/x.json' }, t)).toEqual({ label: 'Read paid data', icon: BookOpenIcon })
    })

    it('keeps the tools stored conversations still hold', () => {
        expect(getToolMeta('leads_email_find', undefined, t)).toEqual({ label: 'Find Email', icon: MailIcon })
        expect(isKnownTool('paid_data')).toBe(true)
    })

    it('reads the English labels word for word', () => {
        expect(getToolMeta('team_list_schedules', undefined, t).label).toBe("List a Coworker's Schedules")
        expect(getToolMeta('write_agent', undefined, t).label).toBe('Writing its SOUL and install')
        expect(getToolMeta('request_mcp_sign_in', undefined, t).label).toBe('Asked you to sign in to an MCP server')
        expect(getToolMeta('mcp__notion__search_pages', undefined, t).label).toBe('Notion Search Pages')
        expect(getToolMeta('gmail_search_threads', undefined, t).label).toBe('Gmail Search Threads')
    })
})
