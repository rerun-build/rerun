import type { Ref } from 'react'

export function OrbDefs({ uid, initialPath, pathRef, rimRef }: { uid: string; initialPath: string; pathRef: Ref<SVGPathElement>; rimRef: Ref<SVGLinearGradientElement> }) {
    return (
        <defs>
            <path ref={pathRef} id={`${uid}-d`} d={initialPath} />

            <linearGradient ref={rimRef} id={`${uid}-rim`} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#ffdcf8" />
                <stop offset="14%" stopColor="#ff7ae2" />
                <stop offset="32%" stopColor="#c05cff" />
                <stop offset="52%" stopColor="#7b45ff" />
                <stop offset="70%" stopColor="#4d34f7" />
                <stop offset="86%" stopColor="#b968ff" />
                <stop offset="100%" stopColor="#ffdcf8" />
            </linearGradient>

            <radialGradient id={`${uid}-core`} cx="34%" cy="26%" r="78%">
                <stop offset="0%" stopColor="#241056" />
                <stop offset="46%" stopColor="#170a3d" />
                <stop offset="100%" stopColor="#0a0322" />
            </radialGradient>

            <linearGradient id={`${uid}-sheen`} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
                <stop offset="22%" stopColor="#f0e2ff" stopOpacity="0.85" />
                <stop offset="44%" stopColor="#ff9be8" stopOpacity="0.2" />
                <stop offset="70%" stopColor="#ffffff" stopOpacity="0" />
                <stop offset="90%" stopColor="#e9d8ff" stopOpacity="0.5" />
                <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
            </linearGradient>

            <radialGradient id={`${uid}-atmo`}>
                <stop offset="0%" stopColor="#4d34f7" stopOpacity="0.5" />
                <stop offset="45%" stopColor="#4d34f7" stopOpacity="0.14" />
                <stop offset="100%" stopColor="#4d34f7" stopOpacity="0" />
            </radialGradient>

            <radialGradient id={`${uid}-iris`}>
                <stop offset="0%" stopColor="#ffffff" />
                <stop offset="55%" stopColor="#f7ecff" />
                <stop offset="100%" stopColor="#d9b8ff" />
            </radialGradient>

            <filter id={`${uid}-bloom`} filterUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
                <feGaussianBlur stdDeviation="2.6" />
            </filter>
            <filter id={`${uid}-halo`} filterUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
                <feGaussianBlur stdDeviation="0.85" />
            </filter>
            <filter id={`${uid}-edge`} filterUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
                <feGaussianBlur stdDeviation="0.28" />
            </filter>
            <filter id={`${uid}-eye`} filterUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
                <feGaussianBlur stdDeviation="1.1" />
            </filter>

            <clipPath id={`${uid}-clip`}>
                <use href={`#${uid}-d`} />
            </clipPath>
        </defs>
    )
}
