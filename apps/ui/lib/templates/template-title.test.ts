import { TEMPLATE_TITLE_MAX_LENGTH, templateDocumentSchema } from '@moldwright/contracts'
import { describe, expect, it } from 'vitest'
import { TEMPLATE_TOOL_DEFS } from '@/lib/mcp/template-tools'
import { templateAuthorPatchSchema } from './expert'
import { duplicateTemplateTitle } from './limits'

describe('template title limit', () => {
    it('accepts 50 characters and rejects 51 in the shared document contract', () => {
        expect(templateDocumentSchema.parse({ slug: 'valid-title', title: 'a'.repeat(TEMPLATE_TITLE_MAX_LENGTH) }).title).toHaveLength(TEMPLATE_TITLE_MAX_LENGTH)
        expect(() => templateDocumentSchema.parse({ slug: 'long-title', title: 'a'.repeat(TEMPLATE_TITLE_MAX_LENGTH + 1) })).toThrow(
            `Title must be ${TEMPLATE_TITLE_MAX_LENGTH} characters or fewer`,
        )
    })

    it('rejects an overlong author patch used by MCP updates', () => {
        expect(() => templateAuthorPatchSchema.strict().parse({ title: 'a'.repeat(TEMPLATE_TITLE_MAX_LENGTH + 1) })).toThrow()
    })

    it('publishes the limit in both MCP title inputs', () => {
        for (const name of ['create_template', 'update_template']) {
            const tool = TEMPLATE_TOOL_DEFS.find(candidate => candidate.name === name)
            const properties = tool?.inputSchema.properties
            expect(properties && 'title' in properties ? properties.title.maxLength : undefined).toBe(TEMPLATE_TITLE_MAX_LENGTH)
        }
    })

    it('keeps duplicated titles within the cap without splitting the last kept word', () => {
        const title = 'Compile weekly customer support performance report'
        expect(title).toHaveLength(TEMPLATE_TITLE_MAX_LENGTH)
        expect(duplicateTemplateTitle(title)).toBe('Compile weekly customer support performance copy')
        expect(duplicateTemplateTitle(title).length).toBeLessThanOrEqual(TEMPLATE_TITLE_MAX_LENGTH)
    })
})
