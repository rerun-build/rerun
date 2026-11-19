'use client'

import { Button } from '@moldwright/ui/primitives'

export function OgCta({ label }: { label: string }) {
    return (
        <Button size="lg" highlight={{ animated: false }} className="h-auto rounded-xl px-7 py-3.5 text-xl">
            {label}
        </Button>
    )
}
