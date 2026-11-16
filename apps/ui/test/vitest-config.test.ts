import { describe, expect, it } from 'vitest'

import config from '../vitest.config'

describe('the ui test run', () => {
    it('gives every test and hook 15 seconds, as the engine run does', () => {
        expect(config.test?.testTimeout).toBe(15000)
        expect(config.test?.hookTimeout).toBe(15000)
    })
})
