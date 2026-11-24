import english from '../messages/en/index'
import { fillBrand } from './brand'
import { withoutContext } from './merge'
import type { Messages } from './messages'

// The English source, loaded at once: for an app that never switches language (the back office of
// Rerun Cloud, which renders the app's components in its labs).
export const ENGLISH_MESSAGES = fillBrand(withoutContext(english)) as Messages
