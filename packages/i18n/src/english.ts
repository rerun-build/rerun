import english from '../messages/en/index'
import { withoutContext } from './merge'
import type { Messages } from './messages'

export const ENGLISH_MESSAGES = withoutContext(english) as Messages
