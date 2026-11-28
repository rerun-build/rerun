import { Icon } from '@/components/ui/icon'
import { ProviderIcon } from '@/lib/engine/provider-icons'
import { KeyIcon } from '@/lib/icons'

type LogoProps = { className?: string }

// Brand marks from Simple Icons, in each brand's own color.
function WindowsLogo({ className }: LogoProps) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="#0078D4" aria-hidden="true">
            <path d="M0,0H11.377V11.372H0ZM12.623,0H24V11.372H12.623ZM0,12.623H11.377V24H0Zm12.623,0H24V24H12.623" />
        </svg>
    )
}

function AndroidLogo({ className }: LogoProps) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="#3DDC84" aria-hidden="true">
            <path d="M18.4395 5.5586c-.675 1.1664-1.352 2.3318-2.0274 3.498-.0366-.0155-.0742-.0286-.1113-.043-1.8249-.6957-3.484-.8-4.42-.787-1.8551.0185-3.3544.4643-4.2597.8203-.084-.1494-1.7526-3.021-2.0215-3.4864a1.1451 1.1451 0 0 0-.1406-.1914c-.3312-.364-.9054-.4859-1.379-.203-.475.282-.7136.9361-.3886 1.5019 1.9466 3.3696-.0966-.2158 1.9473 3.3593.0172.031-.4946.2642-1.3926 1.0177C2.8987 12.176.452 14.772 0 18.9902h24c-.119-1.1108-.3686-2.099-.7461-3.0683-.7438-1.9118-1.8435-3.2928-2.7402-4.1836a12.1048 12.1048 0 0 0-2.1309-1.6875c.6594-1.122 1.312-2.2559 1.9649-3.3848.2077-.3615.1886-.7956-.0079-1.1191a1.1001 1.1001 0 0 0-.8515-.5332c-.5225-.0536-.9392.3128-1.0488.5449zm-.0391 8.461c.3944.5926.324 1.3306-.1563 1.6503-.4799.3197-1.188.0985-1.582-.4941-.3944-.5927-.324-1.3307.1563-1.6504.4727-.315 1.1812-.1086 1.582.4941zM7.207 13.5273c.4803.3197.5506 1.0577.1563 1.6504-.394.5926-1.1038.8138-1.584.4941-.48-.3197-.5503-1.0577-.1563-1.6504.4008-.6021 1.1087-.8106 1.584-.4941z" />
        </svg>
    )
}

function YubicoLogo({ className }: LogoProps) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="#84BD00" aria-hidden="true">
            <path d="m12.356 12.388 2.521-7.138h3.64l-6.135 15.093H8.539l1.755-4.136L6 5.25h3.717ZM12 0C5.381 0 0 5.381 0 12s5.381 12 12 12 12-5.381 12-12S18.619 0 12 0Zm0 1.5c5.808 0 10.5 4.692 10.5 10.5S17.808 22.5 12 22.5 1.5 17.808 1.5 12 6.192 1.5 12 1.5Z" />
        </svg>
    )
}

function AppleLogo({ className }: LogoProps) {
    return <ProviderIcon provider="apple" className={className} />
}

function GoogleLogo({ className }: LogoProps) {
    return <ProviderIcon provider="google" className={className} />
}

// A passkey keeps the name it got from its device (`passkeyNames`) unless the person renamed it, so
// the name is the only hint of where it lives.
function logoForPasskey(name: string) {
    if (/mac|iphone|ipad|apple|icloud/i.test(name)) return AppleLogo
    if (/windows/i.test(name)) return WindowsLogo
    if (/android|pixel|galaxy|samsung/i.test(name)) return AndroidLogo
    if (/chromebook|chrome|google/i.test(name)) return GoogleLogo
    if (/yubi/i.test(name)) return YubicoLogo
    return null
}

export function PasskeyDeviceLogo({ name }: { name: string }) {
    const logo = logoForPasskey(name)
    if (!logo) return <Icon icon={KeyIcon} size="sm" />
    return <Icon icon={logo} size="sm" glyphClassName="size-4" />
}
