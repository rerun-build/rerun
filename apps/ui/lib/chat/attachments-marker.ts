import { uniqueAttachmentName as uniqueName } from '@moldwright/contracts'
import { nanoid } from 'nanoid'

export { appendAttachmentsRef, attachmentDisplayName, buildAttachmentsRef, CHAT_ATTACHMENTS_DIR, parseAttachments, stripAttachmentsRef } from '@moldwright/contracts'

export function uniqueAttachmentName(file: File): string {
    return uniqueName(file.name, nanoid(6))
}
