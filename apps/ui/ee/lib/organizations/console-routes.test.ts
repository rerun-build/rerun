import { readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { CONSOLE_HOME, CONSOLE_SECTIONS, CONSOLE_NEW_WORKSPACE, consoleSectionOf, consoleWorkspaceIdOf, consoleWorkspacePath } from './console-routes'

const PAGES = path.resolve(import.meta.dirname, '../../../app/(ee)/organization/(console)')

describe('the sections of the console', () => {
    it('all have a page', () => {
        const pages = readdirSync(PAGES, { recursive: true, encoding: 'utf8' }).filter(file => path.basename(file) === 'page.tsx').map(file => `/${path.dirname(file)}`.replace(/\/\([^)]*\)/g, ''))
        for (const href of Object.values(CONSOLE_SECTIONS)) expect(pages).toContain(href.slice(CONSOLE_HOME.length))
    })

    it.each([
        [consoleWorkspacePath(12), 12],
        [CONSOLE_NEW_WORKSPACE, null],
        ['/organization', null],
        ['/organization/credit', null],
    ])('%s is on workspace %s', (pathname, id) => {
        expect(consoleWorkspaceIdOf(pathname)).toBe(id)
    })

    it.each([
        ['/organization', 'workspaces'],
        [consoleWorkspacePath(12), 'workspaces'],
        ['/organization/credit', 'credit'],
        ['/organization/team', 'team'],
        ['/organization/brand', 'brand'],
        ['/organization/domains', 'domains'],
        ['/organization/billing', 'workspaces'],
    ])('%s is in %s', (pathname, section) => {
        expect(consoleSectionOf(pathname)).toBe(section)
    })
})
