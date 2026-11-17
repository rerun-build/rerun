import { describe, expect, it } from 'vitest'
import { serializeAnswers, serializeComputerAccessDecision, serializeSpendDecision } from '@rerun/contracts'
import { findComputerGrants, normalizeCommand } from './access.js'

const call = (id: string, input: Record<string, unknown>, toolName = 'request_computer_access') => ({ role: 'assistant', contentJson: JSON.stringify([{ type: 'tool-call', toolCallId: id, toolName, input }]) })
const user = (text: string) => ({ role: 'user', contentJson: JSON.stringify([{ type: 'text', text }]) })
const approve = (computer: string, always?: string) => user(serializeComputerAccessDecision({ computer, decision: 'approved', always }))
const decline = (computer: string) => user(serializeComputerAccessDecision({ computer, decision: 'declined' }))

const ffmpeg = 'ffmpeg -i rush.mov  out.mp4'

describe('findComputerGrants', () => {
    it('grants the exact commands of the latest card the person approved, on that computer', () => {
        const [grant] = findComputerGrants([user('Encode the rushes'), call('t1', { computer: '#Studio-PC', reason: 'encode', commands: [ffmpeg] }), approve('studio-pc')])
        expect(grant.computer).toBe('studio-pc')
        expect([...grant.commands]).toEqual([normalizeCommand(ffmpeg)])
    })

    it('reads the commands of a model that sent them as a JSON string, through the bridge prefix', () => {
        const [grant] = findComputerGrants([call('t1', { computer: 'studio-pc', reason: 'x', commands: JSON.stringify(['ls -la']) }, 'mcp__rerun__request_computer_access'), approve('studio-pc')])
        expect([...grant.commands]).toEqual(['ls -la'])
    })

    it('grants nothing on a no, an unanswered card, or a yes for another computer', () => {
        expect(findComputerGrants([call('t1', { computer: 'studio-pc', commands: ['ls'] }), decline('studio-pc')])).toEqual([])
        expect(findComputerGrants([call('t1', { computer: 'studio-pc', commands: ['ls'] })])).toEqual([])
        expect(findComputerGrants([call('t1', { computer: 'studio-pc', commands: ['ls'] }), approve('laptop')])).toEqual([])
        expect(findComputerGrants([call('t1', { computer: 'studio-pc', commands: ['ls'] }), user('sure, go ahead')])).toEqual([])
    })

    it('ends with the next free message of the person, but lasts through the cards the same task raises', () => {
        const approved = [call('t1', { computer: 'studio-pc', commands: ['ls'] }), approve('studio-pc')]
        expect(findComputerGrants([...approved, user('now do something else')])).toEqual([])
        const answered = serializeAnswers([{ question: 'Which folder?', answers: ['Rushes'] }])
        expect(findComputerGrants([...approved, call('q1', { questions: [] }, 'ask_user'), user(answered)])).toHaveLength(1)
        expect(findComputerGrants([...approved, user(serializeSpendDecision({ purpose: 'x', decision: 'approved' }))])).toHaveLength(1)
    })

    it('counts the latest card only: an older yes is closed by a newer card', () => {
        const older = [call('t1', { computer: 'studio-pc', commands: ['ls'] }), approve('studio-pc')]
        expect(findComputerGrants([...older, call('t2', { computer: 'studio-pc', commands: ['rm x'] })])).toEqual([])
        expect(findComputerGrants([...older, call('t2', { computer: 'studio-pc', commands: ['rm x'] }), decline('studio-pc')])).toEqual([])
    })

    it('keeps a yes to the screen for the whole conversation', () => {
        const grants = findComputerGrants([call('t1', { computer: 'studio-pc', screen: true }), approve('studio-pc'), user('another task'), call('t2', { computer: 'studio-pc', commands: ['ls'] })])
        expect(grants).toEqual([{ computer: 'studio-pc', commands: new Set(), paths: [], screen: true }])
    })

    it('skips what it cannot read', () => {
        expect(findComputerGrants([{ role: 'assistant', contentJson: '{' }, { role: 'assistant', contentJson: '"text"' }, user('hi')])).toEqual([])
    })
})
