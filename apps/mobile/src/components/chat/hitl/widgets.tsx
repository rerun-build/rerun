import { ApprovalWidget } from './ApprovalWidget'
import { McpWidget } from './McpWidget'
import { QuestionWidget } from './QuestionWidget'
import type { HitlWidgets } from './registry'
import { SecretWidget } from './SecretWidget'
import { ServiceWidget } from './ServiceWidget'
import { SpendWidget } from './SpendWidget'
import { TakeoverWidget } from './TakeoverWidget'

// Filled kind by kind. Shipping a widget is a JavaScript change, so an EAS update carries it to the
// builds of the same native runtime without a new review.
export const HITL_WIDGETS: HitlWidgets = {
    question: { maxVersion: 2, render: props => <QuestionWidget {...props} /> },
    approval: { maxVersion: 1, render: props => <ApprovalWidget {...props} /> },
    secret: { maxVersion: 1, render: props => <SecretWidget {...props} /> },
    service: { maxVersion: 1, render: props => <ServiceWidget {...props} /> },
    takeover: { maxVersion: 1, render: props => <TakeoverWidget {...props} /> },
    mcp: { maxVersion: 1, render: props => <McpWidget {...props} /> },
    spend: { maxVersion: 1, render: props => <SpendWidget {...props} /> },
}
