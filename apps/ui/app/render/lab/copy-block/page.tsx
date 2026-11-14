'use client'

import { ImportAgentDialog } from '@/components/dialogs/ImportAgentDialog'
import { useState } from 'react'

export default function CopyBlockLab() {
    const [open, setOpen] = useState(true)
    return (
        <div className="min-h-dvh bg-background">
            <ImportAgentDialog open={open} onOpenChange={setOpen} />
        </div>
    )
}
