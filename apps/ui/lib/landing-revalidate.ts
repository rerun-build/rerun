export async function revalidateLanding(paths: string[]) {
    const base = process.env.NEXT_PUBLIC_LANDING_URL
    const secret = process.env.REVALIDATE_SECRET
    if (!base || !secret || paths.length === 0) return

    try {
        await fetch(`${base.replace(/\/$/, '')}/api/revalidate`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-revalidate-secret': secret },
            body: JSON.stringify({ paths }),
        })
    } catch {
    }
}
