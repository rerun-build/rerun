import { app, desktopCapturer, session as electronSession } from 'electron'
import { trackDownloads } from './downloads'
import { shellUserAgent } from './identity'
import { serveLocalPages } from './local-pages'
import { decidePermission } from './permission-policy'

const prepared = new Set<string>()

function originOf(url: string | undefined | null): string {
    try {
        return url ? new URL(url).origin : ''
    } catch {
        return ''
    }
}

export function prepareSession(partition: string, serverOrigin: string | null): Electron.Session {
    const session = electronSession.fromPartition(partition)
    if (prepared.has(partition)) return session
    prepared.add(partition)

    session.setUserAgent(shellUserAgent(session.getUserAgent()))
    serveLocalPages(session)
    trackDownloads(session)

    session.setPermissionRequestHandler((contents, permission, callback, details) => {
        const requestingOrigin = originOf(details.requestingUrl ?? contents?.getURL())
        const mediaTypes = 'mediaTypes' in details ? details.mediaTypes : undefined
        callback(decidePermission({ permission, requestingOrigin, mediaTypes }, serverOrigin))
    })
    session.setPermissionCheckHandler((_contents, permission, requestingOrigin, details) => {
        const mediaType = 'mediaType' in details ? details.mediaType : undefined
        return decidePermission({ permission, requestingOrigin: originOf(requestingOrigin), mediaType }, serverOrigin)
    })
    // The screenshot attached to a message: the system's own picker where there is one (macOS 15+),
    // the whole main screen elsewhere.
    session.setDisplayMediaRequestHandler(
        (request, callback) => {
            if (!serverOrigin || originOf(request.securityOrigin ?? request.frame?.url) !== serverOrigin) return callback({})
            void desktopCapturer.getSources({ types: ['screen'] }).then((sources) => callback(sources[0] ? { video: sources[0] } : {}))
        },
        { useSystemPicker: true },
    )
    // macOS checks spelling with its own dictionaries, in the languages of the system.
    if (process.platform !== 'darwin') session.setSpellCheckerLanguages(app.getPreferredSystemLanguages().filter((language) => session.availableSpellCheckerLanguages.includes(language)))
    return session
}
