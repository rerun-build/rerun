import { asRecord } from '@rerun/contracts'
import type { StreamTextTransform, TextStreamPart, ToolSet } from 'ai'

// During the onboarding the Boxes of a plan are the ones the welcome card drew, so the model is only
// asked for agents, or for the one Box a template lands in, and the app lays the Boxes into the
// show_plan and show_templates calls itself. Rewritten on the stream rather than by each reader: the
// card, the board, the saved transcript and the build all read that one call, so they cannot disagree
// about which Boxes it holds.

// A Box that is not on the board would become a sixth one at the build, so whatever was filed under
// one lands in the first, the division the board centres on.
function canonicalBox(box: unknown, names: readonly string[]): string {
    return (typeof box === 'string' && names.find(name => name.toLowerCase() === box.trim().toLowerCase())) || names[0]
}

export function pinPlanBoxes(input: unknown, names: readonly string[]): Record<string, unknown> {
    const args = asRecord(input)
    const items = Array.isArray(args.items) ? args.items.map(item => ({ ...asRecord(item), box: canonicalBox(asRecord(item).box, names) })) : []
    return { ...args, boxes: names.map(name => ({ name })), items }
}

// A template card is a plan of one item: the template lands in one Box and the others stay on the
// board around it.
export function pinTemplateBoxes(input: unknown, names: readonly string[]): Record<string, unknown> {
    const args = asRecord(input)
    return { ...args, box: canonicalBox(args.box, names), boxes: names.map(name => ({ name })) }
}

const PINNERS: Record<string, (input: unknown, names: readonly string[]) => Record<string, unknown>> = { show_plan: pinPlanBoxes, show_templates: pinTemplateBoxes }

export function pinPlanBoxesTransform<TOOLS extends ToolSet>(names: readonly string[]): StreamTextTransform<TOOLS> {
    return () =>
        new TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>({
            transform(part, controller) {
                const pin = part.type === 'tool-call' ? PINNERS[part.toolName] : undefined
                controller.enqueue(pin && part.type === 'tool-call' ? ({ ...part, input: pin(part.input, names) } as TextStreamPart<TOOLS>) : part)
            },
        })
}
