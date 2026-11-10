'use client'

import { IsoGrid } from '@rerun/ui/iso-grid'
import { useMemo, type Ref } from 'react'

import { containerFromSpace, tileFromAgent } from '@/lib/board/iso-adapter'
import { CARD_BACKGROUND } from '@/lib/og/size'
import { SceneWatermark } from './SceneWatermark'
import type { WorkspaceScene } from '@/lib/scenes/workspace-scene'

// Le cadre exactement tel qu'il sera capturé : le board à la taille de la scène, signé par le badge
// de marque, sans aucune affordance. Les tiles passent par l'adaptateur du board réel, donc ce qui
// sort d'ici est ce que l'app dessine — statuts, Box, liens compris.
export function WorkspaceSceneStage({ scene, stageRef }: { scene: WorkspaceScene; stageRef?: Ref<HTMLDivElement> }) {
    const tiles = useMemo(() => scene.agents.map(agent => tileFromAgent(agent)), [scene.agents])
    const containers = useMemo(() => scene.spaces.map(space => containerFromSpace(space)), [scene.spaces])

    return (
        <div
            ref={stageRef}
            // Le thème est toujours nommé, jamais absent : les custom properties s'héritent, donc un
            // îlot clair posé dans l'admin (forcé sombre) reprendrait la palette sombre.
            className={`${scene.theme} relative overflow-hidden`}
            style={{ width: scene.width, height: scene.height, background: CARD_BACKGROUND[scene.theme] }}
        >
            <IsoGrid tiles={tiles} containers={containers} liveLinks={scene.links} camera={scene.camera} cameraTransitionMs={0} scrollGestures={false} selectedTileId={null} />
            <SceneWatermark />
        </div>
    )
}
