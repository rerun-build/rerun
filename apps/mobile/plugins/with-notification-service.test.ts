import { IOSConfig } from 'expo/config-plugins'

type Config = { ios?: Record<string, unknown>; extra?: Record<string, unknown>; [key: string]: unknown }
type Plugin = ((config: Config) => Config) & { addNotificationService: (project: Project, options: Record<string, string>) => Project }
type Project = ReturnType<typeof IOSConfig.XcodeUtils.getPbxproj>

// The app's TypeScript program has no Node types.
type NodeFs = { mkdirSync(path: string, options: { recursive: boolean }): void; mkdtempSync(prefix: string): string; rmSync(path: string, options: { recursive: boolean; force: boolean }): void; writeFileSync(path: string, data: string): void }
/* eslint-disable @typescript-eslint/no-require-imports */
const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs') as NodeFs
const { tmpdir } = require('node:os') as { tmpdir(): string }
const { join } = require('node:path') as { join(...parts: string[]): string }
const withNotificationService = require('./with-notification-service') as Plugin
/* eslint-enable @typescript-eslint/no-require-imports */

const OPTIONS = { bundleIdentifier: 'build.rerun.app.NotificationService', deploymentTarget: '26.0', marketingVersion: '1.0.3', buildNumber: '7' }

const APP_PROJECT = `// !$*UTF8*$!
{
	archiveVersion = 1;
	classes = {};
	objectVersion = 46;
	objects = {
/* Begin PBXBuildFile section */
/* End PBXBuildFile section */
/* Begin PBXFileReference section */
		A1 /* Rerun.app */ = {isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = Rerun.app; sourceTree = BUILT_PRODUCTS_DIR; };
/* End PBXFileReference section */
/* Begin PBXGroup section */
		A2 = {isa = PBXGroup; children = (A3 /* Products */, ); sourceTree = "<group>"; };
		A3 /* Products */ = {isa = PBXGroup; children = (A1 /* Rerun.app */, ); name = Products; sourceTree = "<group>"; };
/* End PBXGroup section */
/* Begin PBXNativeTarget section */
		A4 /* Rerun */ = {isa = PBXNativeTarget; buildConfigurationList = A5; buildPhases = (); buildRules = (); dependencies = (); name = Rerun; productName = Rerun; productReference = A1; productType = "com.apple.product-type.application"; };
/* End PBXNativeTarget section */
/* Begin PBXProject section */
		A6 /* Project object */ = {isa = PBXProject; attributes = {}; buildConfigurationList = A5; mainGroup = A2; productRefGroup = A3; targets = (A4 /* Rerun */, ); };
/* End PBXProject section */
/* Begin XCBuildConfiguration section */
		A7 /* Release */ = {isa = XCBuildConfiguration; buildSettings = {PRODUCT_NAME = Rerun; }; name = Release; };
/* End XCBuildConfiguration section */
/* Begin XCConfigurationList section */
		A5 = {isa = XCConfigurationList; buildConfigurations = (A7 /* Release */, ); defaultConfigurationName = Release; };
/* End XCConfigurationList section */
	};
	rootObject = A6 /* Project object */;
}
`

describe('with-notification-service', () => {
    let root: string
    let project: Project

    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), 'notification-service-'))
        mkdirSync(join(root, 'ios', 'Rerun.xcodeproj'), { recursive: true })
        writeFileSync(join(root, 'ios', 'Rerun.xcodeproj', 'project.pbxproj'), APP_PROJECT)
        project = IOSConfig.XcodeUtils.getPbxproj(root)
    })
    afterEach(() => rmSync(root, { recursive: true, force: true }))

    const objects = () => project.hash.project.objects
    const entries = (section: string): [string, Record<string, any>][] => Object.entries(objects()[section] ?? {}).filter(([key]) => !key.endsWith('_comment')) as [string, Record<string, any>][]
    const targetNamed = (name: string) => entries('PBXNativeTarget').find(([, target]) => target.name === name)
    const embedPhases = () => entries('PBXCopyFilesBuildPhase').filter(([, phase]) => String(phase.name).includes('Embed Foundation Extensions'))

    it('adds an extension target the app depends on and embeds', () => {
        withNotificationService.addNotificationService(project, OPTIONS)

        const [uuid, extension] = targetNamed('NotificationService')!
        expect(extension.productType).toBe('"com.apple.product-type.app-extension"')
        const [, app] = targetNamed('Rerun')!
        const dependencies = app.dependencies.map((dependency: { value: string }) => objects().PBXTargetDependency[dependency.value].target)
        expect(dependencies).toEqual([uuid])
        const [[, embed]] = embedPhases()
        expect(embed.dstSubfolderSpec).toBe(13)
        expect(embed.files.map((file: { comment: string }) => file.comment)).toEqual(['NotificationService.appex in Embed Foundation Extensions'])
    })

    it('compiles its Swift file, with the version and the minimum iOS of the app', () => {
        withNotificationService.addNotificationService(project, OPTIONS)

        const [, extension] = targetNamed('NotificationService')!
        const sources = extension.buildPhases.map((phase: { value: string }) => objects().PBXSourcesBuildPhase[phase.value]).filter(Boolean)
        expect(sources[0].files.map((file: { comment: string }) => file.comment)).toEqual(['NotificationService.swift in Sources'])
        const configurations = entries('XCBuildConfiguration').filter(([, configuration]) => configuration.buildSettings.INFOPLIST_FILE === 'NotificationService/Info.plist')
        expect(configurations.map(([, configuration]) => configuration.name)).toEqual(['Debug', 'Release'])
        for (const [, { buildSettings }] of configurations) {
            expect(buildSettings).toMatchObject({ PRODUCT_BUNDLE_IDENTIFIER: '"build.rerun.app.NotificationService"', IPHONEOS_DEPLOYMENT_TARGET: '"26.0"', MARKETING_VERSION: '"1.0.3"', CURRENT_PROJECT_VERSION: '"7"', SWIFT_VERSION: '5.0' })
        }
    })

    it('embeds beside another extension, in the phase that one made', () => {
        const app = project.getFirstTarget().uuid
        project.addBuildPhase([], 'PBXCopyFilesBuildPhase', 'Embed Foundation Extensions', app, 'app_extension', '""')
        embedPhases()[0][1].files.push({ value: 'W1', comment: 'ExpoWidgetsTarget.appex in Embed Foundation Extensions' })

        withNotificationService.addNotificationService(project, OPTIONS)

        expect(embedPhases()).toHaveLength(1)
        expect(embedPhases()[0][1].files.map((file: { comment: string }) => file.comment)).toEqual(['ExpoWidgetsTarget.appex in Embed Foundation Extensions', 'NotificationService.appex in Embed Foundation Extensions'])
    })

    it('changes nothing run a second time', () => {
        withNotificationService.addNotificationService(project, OPTIONS)
        const once = project.writeSync()
        withNotificationService.addNotificationService(project, OPTIONS)
        expect(project.writeSync()).toBe(once)
    })

    it('declares the communication entitlement, the message intent and the extension EAS signs, keeping what is there', () => {
        const config = withNotificationService({
            ios: { bundleIdentifier: 'build.rerun.app', entitlements: { other: true }, infoPlist: { NSUserActivityTypes: ['handoff'] } },
            extra: { eas: { projectId: 'p', build: { experimental: { ios: { appExtensions: [{ targetName: 'ExpoWidgetsTarget' }] } } } } },
        })
        expect(config.ios).toMatchObject({ entitlements: { other: true, 'com.apple.developer.usernotifications.communication': true }, infoPlist: { NSUserActivityTypes: ['handoff', 'INSendMessageIntent'] } })
        expect(config.extra).toMatchObject({
            eas: { projectId: 'p', build: { experimental: { ios: { appExtensions: [{ targetName: 'ExpoWidgetsTarget' }, { targetName: 'NotificationService', bundleIdentifier: 'build.rerun.app.NotificationService' }] } } } },
        })
    })
})
