'use client'

import { IsoGrid } from '@moldwright/ui/iso-grid'
import { useMemo, type Ref } from 'react'

import { containerFromSpace, tileFromAgent } from '@/lib/board/iso-adapter'
import { CARD_BACKGROUND } from '@/lib/og/size'
import { SceneWatermark } from './SceneWatermark'
import type { WorkspaceScene } from '@/lib/scenes/workspace-scene'

export function WorkspaceSceneStage({ scene, stageRef }: { scene: WorkspaceScene; stageRef?: Ref<HTMLDivElement> }) {
    const tiles = useMemo(() => scene.agents.map(agent => tileFromAgent(agent)), [scene.agents])
    const containers = useMemo(() => scene.spaces.map(space => containerFromSpace(space)), [scene.spaces])

    return (
        <div
            ref={stageRef}
            className={`${scene.theme} relative overflow-hidden`}
            style={{ width: scene.width, height: scene.height, background: CARD_BACKGROUND[scene.theme] }}
        >
            <IsoGrid tiles={tiles} containers={containers} liveLinks={scene.links} camera={scene.camera} cameraTransitionMs={0} scrollGestures={false} selectedTileId={null} />
            <SceneWatermark />
        </div>
    )
}
