import { File } from 'expo-file-system'
import { widgetsDirectory } from 'expo-widgets'

import { fetchBoard } from '@/api/board'
import { toHomeCoworkers } from '@/components/home/board'
import { translatorFor } from '@/i18n/translator'

import CrewWidget from './CrewWidget'
import { crewWidgetPropsOf, type CrewWidgetProps } from './crew-props'
import { syncCrewActivity } from './live-activity'

type Caller = { accessToken: string; workspaceId: number }

export const facesDirectory = widgetsDirectory?.replace(/\/$/, '') ?? null

// Away from the Home nothing draws a buddy: a face not on disk yet is left out rather than shown blank.
function withDrawnFaces(props: CrewWidgetProps): CrewWidgetProps {
    return { ...props, members: props.members.map(member => (member.face && !new File(member.face).exists ? { ...member, face: '' } : member)) }
}

// The crew read again by the app woken in the background, for the widgets and the Live Activity,
// which would otherwise wait for the app to be opened.
export async function refreshWidgets(caller: Caller): Promise<void> {
    const { agents, overview } = await fetchBoard(caller)
    const props = withDrawnFaces(crewWidgetPropsOf(toHomeCoworkers(agents, overview), translatorFor('mobileHome'), facesDirectory))
    CrewWidget.updateSnapshot(props)
    await syncCrewActivity(props)
}
