// Le logo Rerun vit désormais dans le package partagé @rerun/ui/logo (consommé aussi
// par la landing). On ré-exporte ici pour préserver les imports existants
// (`@/components/layout/Logo`).
export { Logo, AnimatedLogo } from '@rerun/ui/logo'
