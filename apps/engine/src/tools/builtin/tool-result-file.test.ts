import { mkdtempSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-tool-results-'))

const { describe, expect, it } = await import('vitest')
const { dynamicTool, jsonSchema, tool } = await import('ai')
const { z } = await import('zod')
const { workspaceDir } = await import('../../config/paths.js')
const { capToolResult, capToolSet, readToolResult, TOOL_RESULT_CHAR_LIMIT, TOOL_RESULTS_DIR, toolResultReadTool } = await import('./tool-result-file.js')

const AGENT = 'cap-agent'
const options = { toolCallId: 'c1', messages: [] }
const savedPathOf = (text: string): string => /saved at (\S+\.txt)/.exec(text)![1]!

describe('capToolResult', () => {
    it('hands back a result under the limit untouched', async () => {
        const text = 'y'.repeat(TOOL_RESULT_CHAR_LIMIT)
        expect(await capToolResult(AGENT, 'gmail_fetch', text)).toBe(text)
    })

    it('cuts a 1 MB result to its head, says its size and saves it whole', async () => {
        const text = `${'a'.repeat(TOOL_RESULT_CHAR_LIMIT)}${'b'.repeat(1_000_000)}`
        const capped = await capToolResult(AGENT, 'gmail_fetch', text)
        expect(capped.startsWith('a'.repeat(TOOL_RESULT_CHAR_LIMIT))).toBe(true)
        expect(capped).not.toContain('bb')
        expect(capped).toContain(`Cut at ${TOOL_RESULT_CHAR_LIMIT} of ${text.length} characters`)
        expect(capped).toContain('tool_result_read')
        const saved = savedPathOf(capped)
        expect(saved.startsWith(`${TOOL_RESULTS_DIR}/gmail_fetch-`)).toBe(true)
        expect(await readFile(join(workspaceDir(AGENT), saved), 'utf8')).toBe(text)
    })

    it('still cuts when the result cannot be saved, and asks for less', async () => {
        const agent = 'blocked-agent'
        await mkdir(join(workspaceDir(agent), '.rerun'), { recursive: true })
        await writeFile(join(workspaceDir(agent), TOOL_RESULTS_DIR), 'a file where the folder goes')
        const capped = await capToolResult(agent, 'team_get_run', 'z'.repeat(200_000))
        expect(capped.length).toBeLessThan(TOOL_RESULT_CHAR_LIMIT + 500)
        expect(capped).toContain('could not be saved')
        expect(capped).not.toContain('saved at')
    })
})

describe('readToolResult', () => {
    it('reads a saved result back a page at a time, to the end', async () => {
        const text = Array.from({ length: 100_000 }, (_, i) => String(i % 10)).join('')
        const saved = savedPathOf(await capToolResult(AGENT, 'gmail_fetch', text))
        let offset: number | undefined = 0
        let rebuilt = ''
        while (offset !== undefined) {
            const page: Awaited<ReturnType<typeof readToolResult>> = await readToolResult(AGENT, saved, offset)
            expect(page.total).toBe(text.length)
            expect(page.text.length).toBeLessThanOrEqual(38_000)
            rebuilt += page.text
            offset = page.next
        }
        expect(rebuilt).toBe(text)
    })

    it('refuses a path outside the saved results', async () => {
        await expect(readToolResult(AGENT, '.rerun/paid-data/x.json')).rejects.toThrow('Not a saved tool result')
        await expect(readToolResult(AGENT, `${TOOL_RESULTS_DIR}/../../SOUL.md`)).rejects.toThrow('Not a saved tool result')
        await expect(readToolResult(AGENT, `${TOOL_RESULTS_DIR}/missing.txt`)).rejects.toThrow('No saved tool result')
    })

    it('is offered as a tool', async () => {
        const saved = savedPathOf(await capToolResult(AGENT, 'gmail_fetch', 'q'.repeat(50_000)))
        const read = toolResultReadTool(AGENT).tool_result_read!
        expect(await read.execute!({ saved, offset: 49_990 }, options)).toBe(`${'q'.repeat(10)}\n[Characters 49990 to 50000 of 50000 of the result saved at ${saved}: this is the end.]`)
    })

    it('hands a page of quoted JSON to the model under the limit, with where to read on', async () => {
        const nested = JSON.stringify([{ type: 'text', text: JSON.stringify({ messages: Array.from({ length: 2_000 }, (_, i) => ({ id: `m${i}`, body: 'Hi,\n"Thanks"' })) }) }])
        const saved = savedPathOf(await capToolResult(AGENT, 'gmail_fetch', nested))
        const page = (await toolResultReadTool(AGENT).tool_result_read!.execute!({ saved, offset: TOOL_RESULT_CHAR_LIMIT }, options)) as string
        expect(page.length).toBeLessThanOrEqual(TOOL_RESULT_CHAR_LIMIT)
        expect(page.startsWith(nested.slice(TOOL_RESULT_CHAR_LIMIT, TOOL_RESULT_CHAR_LIMIT + 38_000))).toBe(true)
        expect(page).toContain(`of ${nested.length} of the result saved at ${saved}: read on with tool_result_read from offset ${TOOL_RESULT_CHAR_LIMIT + 38_000}.]`)
    })
})

describe('capToolSet', () => {
    const big = { messages: [{ body: 'm'.repeat(300_000) }] }
    const set = capToolSet(
        {
            gmail_GMAIL_FETCH_EMAILS: dynamicTool({ description: 'MCP', inputSchema: jsonSchema({ type: 'object' }), execute: async () => JSON.stringify(big) }),
            team_get_run: tool({ description: 'hub', inputSchema: z.object({}), execute: async () => big }),
            team_status: tool({ description: 'hub', inputSchema: z.object({}), execute: async () => ({ agents: [{ id: 'a' }] }) }),
            paid_data: tool({ description: 'paid', inputSchema: z.object({}), execute: async () => big }),
        },
        AGENT,
    )

    it('cuts an MCP text result and a hub object over the limit', async () => {
        for (const name of ['gmail_GMAIL_FETCH_EMAILS', 'team_get_run']) {
            const out = (await set[name]!.execute!({}, options)) as string
            expect(typeof out, name).toBe('string')
            expect(out.length, name).toBeLessThan(TOOL_RESULT_CHAR_LIMIT + 500)
            expect(out, name).toContain(`whole result of ${name} is saved at`)
            expect(JSON.parse(await readFile(join(workspaceDir(AGENT), savedPathOf(out)), 'utf8')), name).toEqual(big)
        }
    })

    it('leaves an object under the limit as it was', async () => {
        expect(await set.team_status!.execute!({}, options)).toEqual({ agents: [{ id: 'a' }] })
    })

    it('leaves paid_data, which keeps its own answers, alone', async () => {
        expect(await set.paid_data!.execute!({}, options)).toBe(big)
    })

    it('keeps what describes the tool', () => {
        expect(set.gmail_GMAIL_FETCH_EMAILS!.description).toBe('MCP')
        expect(set.gmail_GMAIL_FETCH_EMAILS!.type).toBe('dynamic')
    })
})
