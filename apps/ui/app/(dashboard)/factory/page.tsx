import { routes } from '@/lib/routes'
import { permanentRedirect } from 'next/navigation'

export default function FactoryRedirect() {
    permanentRedirect(routes.home)
}
