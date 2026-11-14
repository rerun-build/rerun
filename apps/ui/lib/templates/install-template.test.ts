import { isSetupAnswered } from '@rerun/contracts'
import { describe, expect, it } from 'vitest'
import { DEFAULT_INSTALL_PROMPT } from './install-template'

describe('DEFAULT_INSTALL_PROMPT', () => {
    it('answers the setup question on its own', () => {
        expect(isSetupAnswered({ required: true, prompt: DEFAULT_INSTALL_PROMPT })).toBe(true)
    })

    it.each(['ask_user', 'suggest_service', 'memory_write', 'install_complete'])('tells the agent to use %s', tool => {
        expect(DEFAULT_INSTALL_PROMPT).toContain(tool)
    })
})
