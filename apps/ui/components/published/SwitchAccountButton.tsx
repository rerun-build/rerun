'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { createClient } from '@/supabase/client'

export function SwitchAccountButton({ returnTo }: { returnTo: string }) {
    const [loading, setLoading] = useState(false)

    const switchAccount = async () => {
        setLoading(true)
        await createClient().auth.signOut()
        window.location.href = `/auth?next=${encodeURIComponent(returnTo)}`
    }

    return (
        <Button variant="outline" size="lg" onClick={switchAccount} loading={loading}>
            Switch account
        </Button>
    )
}
