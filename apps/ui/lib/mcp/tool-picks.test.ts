import { describe, expect, it } from 'vitest'
import { groupTools, pickedTokens, ROLE_TOOL_SETS, roleSetPicks, startingContextTokens } from './tool-picks'

const tools = [
    { name: 'search_symbols', tokens: 10 },
    { name: 'search_text', tokens: 20 },
    { name: 'get_symbol', tokens: 30 },
    { name: 'get_file_content', tokens: 40 },
    { name: 'health', tokens: 5 },
    { name: 'run_and_watch', tokens: 7 },
]

const CODE = 'analyze_file_impact ask batch_edit batch_insert batch_rename checkpoint_now context_inventory conventions curate_knowledge delete_symbol detect_impact diff_symbols edit_plan edit_within_symbol explore find_dependents find_references get_file_content get_file_context get_repo_map get_symbol get_symbol_context health health_compact index_folder insert_symbol inspect_match investigation_suggest replace_symbol_body review_knowledge search_files search_knowledge search_symbols search_text secret_remediate status symforge_edit symforge_retrieve validate_file_syntax what_changed'.split(' ').map(name => ({ name, tokens: 1 }))
const TERMINAL = 'audit_since bucket_events_since bucket_summary bucket_wait command_output_tail command_start_combed command_status command_stop run_and_watch shell_exec health'.split(' ').map(name => ({ name, tokens: 1 }))

describe('groupTools', () => {
    it('groups by the word before the first underscore, single tools last under other', () => {
        expect(groupTools(tools).map(g => [g.group, g.tools.map(t => t.name)])).toEqual([
            ['search', ['search_symbols', 'search_text']],
            ['get', ['get_symbol', 'get_file_content']],
            ['other', ['health', 'run_and_watch']],
        ])
    })
})

describe('pickedTokens', () => {
    it('counts every tool when nothing is picked', () => expect(pickedTokens(tools, [])).toBe(112))
    it('counts only the picked tools', () => expect(pickedTokens(tools, ['get_symbol', 'health'])).toBe(35))
    it('ignores a pick the server does not serve', () => expect(pickedTokens(tools, ['nope'])).toBe(0))
})

describe('startingContextTokens', () => {
    it('adds the instructions, the families switched on and the picked tools of every server', () => {
        expect(
            startingContextTokens({
                promptTokens: 1000,
                families: [{ enabled: true, tokens: 162 }, { enabled: false, tokens: 597 }, { enabled: true }],
                servers: [{ tools, picks: ['get_symbol'] }, { tools, picks: [] }],
            }),
        ).toBe(1304)
    })
})

describe('role sets', () => {
    it('has the four roles with 4, 7, 7 and 5 tools', () => {
        expect(Object.fromEntries(Object.entries(ROLE_TOOL_SETS).map(([role, set]) => [role, set.length]))).toEqual({ lookup: 4, reviewer: 7, builder: 7, runner: 5 })
    })
    it('picks the lookup set from a code server in the server order', () => {
        expect(roleSetPicks('lookup', CODE)).toEqual(['find_references', 'get_file_content', 'get_symbol', 'search_symbols'])
    })
    it('picks the runner set from a terminal server in the server order', () => {
        expect(roleSetPicks('runner', TERMINAL)).toEqual(['bucket_wait', 'command_output_tail', 'command_status', 'command_stop', 'run_and_watch'])
    })
    it('picks nothing when the server serves none of the set', () => {
        expect(roleSetPicks('runner', CODE)).toEqual([])
    })
})
