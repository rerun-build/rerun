import type { CrewState } from '@rerun/contracts'
import { Directory, File } from 'expo-file-system'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PixelRatio, Platform, View } from 'react-native'
import type Svg from 'react-native-svg'

import { AgentBuddy } from '@/components/buddy/AgentBuddy'
import type { HomeCoworker } from '@/components/home/board'
import { translatorFor } from '@/i18n/translator'

import CrewWidget from './CrewWidget'
import { crewWidgetPropsOf, FACE_SIZE, faceFileName, isStaleFace, type CrewWidgetProps } from './crew-props'
import { syncCrewActivity } from './live-activity'
import { facesDirectory } from './refresh'

// The buddy grows into place when it mounts: drawn before then, the picture would catch it halfway.
const FACE_SETTLE_MS = 900

// iOS reads the size of the picture in points and crops it to the drawing; Android reads pixels and fits the
// drawing into them, so it needs the screen's density to stay sharp.
const FACE_EXPORT_SIZE = Platform.OS === 'android' ? PixelRatio.getPixelSizeForLayoutSize(FACE_SIZE) : FACE_SIZE

type Face = { id: string; state: CrewState; file: File }

// A face that could not be saved is not drawn again until the next launch: the widget goes without it.
function missingFaces(props: CrewWidgetProps, tried: ReadonlySet<string>): Face[] {
    if (!facesDirectory) return []
    return props.members.flatMap(member => {
        const file = new File(facesDirectory, faceFileName(member.id, member.state))
        return file.exists || tried.has(file.uri) ? [] : [{ id: member.id, state: member.state, file }]
    })
}

// Draws one buddy off screen and keeps it as the picture a widget shows. A widget cannot draw the
// buddy itself: it renders SwiftUI or Compose, not the app's SVG.
function FacePicture({ face, onDone }: { face: Face; onDone: (uri: string) => void }) {
    const svg = useRef<Svg>(null)
    useEffect(() => {
        const timer = setTimeout(() => {
            const drawing = svg.current
            if (!drawing) return onDone(face.file.uri)
            drawing.toDataURL(
                base64 => {
                    face.file.write(base64, { encoding: 'base64' }).catch(error => console.warn('[widgets] a face was not saved', error)).finally(() => onDone(face.file.uri))
                },
                { width: FACE_EXPORT_SIZE, height: FACE_EXPORT_SIZE }
            )
        }, FACE_SETTLE_MS)
        return () => clearTimeout(timer)
    }, [face, onDone])
    return <AgentBuddy agentId={face.id} mood={face.state} size={FACE_SIZE} animated={false} svgRef={svg} />
}

function deleteStaleFaces() {
    if (!facesDirectory) return
    try {
        for (const entry of new Directory(facesDirectory).list()) {
            if (entry instanceof File && isStaleFace(entry.name)) entry.delete()
        }
    } catch (error) {
        console.warn('[widgets] old faces were not deleted', error)
    }
}

// The widgets show what the Home shows: each time its coworkers change, the widgets get the same crew,
// once the faces they need are on disk. Mounted with the Home, which reads the board for the whole app.
export function WidgetSync({ coworkers }: { coworkers: HomeCoworker[] }) {
    const props = useMemo(() => crewWidgetPropsOf(coworkers, translatorFor('mobileHome'), facesDirectory), [coworkers])
    const [tried, setTried] = useState<ReadonlySet<string>>(() => new Set())
    const next = useMemo(() => missingFaces(props, tried)[0] ?? null, [props, tried])
    const pushed = useRef('')
    const drawn = useCallback((uri: string) => setTried(current => new Set(current).add(uri)), [])

    useEffect(deleteStaleFaces, [])

    useEffect(() => {
        if (next) return
        const serialized = JSON.stringify(props)
        if (serialized === pushed.current) return
        pushed.current = serialized
        CrewWidget.updateSnapshot(props)
        void syncCrewActivity(props)
    }, [next, props])

    if (!next) return null
    return (
        <View pointerEvents="none" style={{ position: 'absolute', left: -FACE_SIZE * 4, top: 0, width: FACE_SIZE, height: FACE_SIZE }}>
            <FacePicture key={next.file.uri} face={next} onDone={drawn} />
        </View>
    )
}
