import { type TemplateDocument, templateDocumentSchema } from '@moldwright/contracts'
import { zodResolver } from '@hookform/resolvers/zod'
import type { Resolver } from 'react-hook-form'

export const adminTemplateSchema = templateDocumentSchema
export type TemplateFormValues = TemplateDocument

export const templateFormResolver = zodResolver(adminTemplateSchema) as unknown as Resolver<TemplateFormValues, unknown, TemplateFormValues>
