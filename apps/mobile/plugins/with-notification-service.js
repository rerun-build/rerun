// The iOS notification service extension, which puts a coworker's portrait at the left of its push
// (notification-service/NotificationService.swift). A target of its own beside the app and the widgets.
//
// Its target is built step by step, as expo-widgets builds its own, rather than with xcode's
// `addTarget`: that one gives an extension a second phase that copies it in the app, and no Swift
// settings. Every step finds what is already there, so it runs in any order with expo-widgets and twice
// on the same project.

const fs = require('fs')
const path = require('path')
const { withDangerousMod, withXcodeProject } = require('expo/config-plugins')

const TARGET = 'NotificationService'
const SOURCE = 'NotificationService.swift'
const EMBED_PHASE = 'Embed Foundation Extensions'
const COMMUNICATION = 'com.apple.developer.usernotifications.communication'
const MESSAGE_INTENT = 'INSendMessageIntent'

const INFO_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>$(DEVELOPMENT_LANGUAGE)</string>
  <key>CFBundleDisplayName</key>
  <string>${TARGET}</string>
  <key>CFBundleExecutable</key>
  <string>$(EXECUTABLE_NAME)</string>
  <key>CFBundleIdentifier</key>
  <string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>$(PRODUCT_NAME)</string>
  <key>CFBundlePackageType</key>
  <string>$(PRODUCT_BUNDLE_PACKAGE_TYPE)</string>
  <key>CFBundleShortVersionString</key>
  <string>$(MARKETING_VERSION)</string>
  <key>CFBundleVersion</key>
  <string>$(CURRENT_PROJECT_VERSION)</string>
  <key>NSExtension</key>
  <dict>
    <key>NSExtensionPointIdentifier</key>
    <string>com.apple.usernotifications.service</string>
    <key>NSExtensionPrincipalClass</key>
    <string>$(PRODUCT_MODULE_NAME).NotificationService</string>
  </dict>
</dict>
</plist>
`

const quoted = value => `"${value}"`

function buildSettings({ bundleIdentifier, deploymentTarget, marketingVersion, buildNumber, appleTeamId }) {
    return {
        PRODUCT_NAME: quoted('$(TARGET_NAME)'),
        PRODUCT_BUNDLE_IDENTIFIER: quoted(bundleIdentifier),
        INFOPLIST_FILE: `${TARGET}/Info.plist`,
        IPHONEOS_DEPLOYMENT_TARGET: quoted(deploymentTarget),
        MARKETING_VERSION: quoted(marketingVersion),
        CURRENT_PROJECT_VERSION: quoted(buildNumber),
        SWIFT_VERSION: '5.0',
        TARGETED_DEVICE_FAMILY: quoted('1,2'),
        APPLICATION_EXTENSION_API_ONLY: 'YES',
        SKIP_INSTALL: 'YES',
        ...(appleTeamId ? { DEVELOPMENT_TEAM: appleTeamId } : {}),
    }
}

function addNotificationService(project, options) {
    if (project.findTargetKey(TARGET)) return project

    const settings = buildSettings(options)
    const configurations = project.addXCConfigurationList(
        [
            { name: 'Debug', isa: 'XCBuildConfiguration', buildSettings: { ...settings, SWIFT_OPTIMIZATION_LEVEL: quoted('-Onone') } },
            { name: 'Release', isa: 'XCBuildConfiguration', buildSettings: { ...settings, SWIFT_OPTIMIZATION_LEVEL: quoted('-O') } },
        ],
        'Release',
        `Build configuration list for PBXNativeTarget ${quoted(TARGET)}`
    )
    const product = project.addProductFile(TARGET, {
        basename: `${TARGET}.appex`,
        group: EMBED_PHASE,
        explicitFileType: 'wrapper.app-extension',
        settings: { ATTRIBUTES: ['RemoveHeadersOnCopy'] },
        includeInIndex: 0,
        path: `${TARGET}.appex`,
        sourceTree: 'BUILT_PRODUCTS_DIR',
    })
    const target = {
        uuid: project.generateUuid(),
        pbxNativeTarget: {
            isa: 'PBXNativeTarget',
            name: TARGET,
            productName: TARGET,
            productReference: product.fileRef,
            productType: quoted('com.apple.product-type.app-extension'),
            buildConfigurationList: configurations.uuid,
            buildPhases: [],
            buildRules: [],
            dependencies: [],
        },
    }
    project.addToPbxNativeTargetSection(target)
    project.addToPbxProjectSection(target)

    // Without these two sections, xcode's `addTargetDependency` does nothing and says nothing.
    const objects = project.hash.project.objects
    objects.PBXTargetDependency ??= {}
    objects.PBXContainerItemProxy ??= {}
    const app = project.getFirstTarget()
    project.addTargetDependency(app.uuid, [target.uuid])

    project.addBuildPhase([SOURCE], 'PBXSourcesBuildPhase', 'Sources', target.uuid, 'app_extension', '""')
    project.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', target.uuid, 'app_extension', '""')
    embed(project, app.uuid, product)
    addGroup(project)
    return project
}

// The phase of the app's target that copies its extensions, which expo-widgets may have made already.
function embed(project, appUuid, product) {
    const phases = () => project.hash.project.objects.PBXCopyFilesBuildPhase ?? {}
    const find = () => {
        const reference = project.pbxNativeTargetSection()[appUuid].buildPhases.find(phase => phase.comment === EMBED_PHASE && phases()[phase.value])
        return reference && phases()[reference.value]
    }
    if (!find()) project.addBuildPhase([], 'PBXCopyFilesBuildPhase', EMBED_PHASE, appUuid, 'app_extension', '""')
    find().files.push({ value: product.uuid, comment: `${product.basename} in ${EMBED_PHASE}` })
    if (!project.pbxBuildFileSection()[product.uuid]) project.addToPbxBuildFileSection(product)
}

function addGroup(project) {
    const { uuid } = project.addPbxGroup([SOURCE, 'Info.plist'], TARGET, TARGET)
    project.addToPbxGroup(uuid, project.getFirstProject().firstProject.mainGroup)
}

// EAS signs each extension it is told about, and creates its identifier on the first build.
function withEasExtension(config, bundleIdentifier) {
    const build = config.extra?.eas?.build
    const extensions = build?.experimental?.ios?.appExtensions ?? []
    if (extensions.some(extension => extension.targetName === TARGET)) return config
    const appExtensions = [...extensions, { targetName: TARGET, bundleIdentifier, entitlements: {} }]
    return {
        ...config,
        extra: {
            ...config.extra,
            eas: { ...config.extra?.eas, build: { ...build, experimental: { ...build?.experimental, ios: { ...build?.experimental?.ios, appExtensions } } } },
        },
    }
}

function withCommunicationNotifications(config) {
    const activities = config.ios?.infoPlist?.NSUserActivityTypes ?? []
    return {
        ...config,
        ios: {
            ...config.ios,
            entitlements: { ...config.ios?.entitlements, [COMMUNICATION]: true },
            infoPlist: { ...config.ios?.infoPlist, NSUserActivityTypes: [...new Set([...activities, MESSAGE_INTENT])] },
        },
    }
}

function withNotificationService(config) {
    const appIdentifier = config.ios?.bundleIdentifier
    if (!appIdentifier) return config
    const bundleIdentifier = `${appIdentifier}.${TARGET}`

    config = withEasExtension(withCommunicationNotifications(config), bundleIdentifier)
    config = withDangerousMod(config, [
        'ios',
        config => {
            const directory = path.join(config.modRequest.platformProjectRoot, TARGET)
            fs.rmSync(directory, { recursive: true, force: true })
            fs.mkdirSync(directory, { recursive: true })
            fs.copyFileSync(require.resolve('./notification-service/NotificationService.swift'), path.join(directory, SOURCE))
            fs.writeFileSync(path.join(directory, 'Info.plist'), INFO_PLIST)
            return config
        },
    ])
    return withXcodeProject(config, config => {
        config.modResults = addNotificationService(config.modResults, {
            bundleIdentifier,
            deploymentTarget: config.ios?.deploymentTarget ?? '26.0',
            marketingVersion: config.ios?.version ?? config.version ?? '1.0',
            buildNumber: config.ios?.buildNumber ?? '1',
            appleTeamId: config.ios?.appleTeamId,
        })
        return config
    })
}

module.exports = withNotificationService
module.exports.addNotificationService = addNotificationService
