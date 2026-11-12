// The plan's subscription as StoreKit testing sells it in Xcode, without App Store Connect: Rerun.storekit
// (the product, its price and its free week) is copied next to the Xcode project and named in the
// scheme's Run action. A run started from Xcode then shows the real purchase sheet on the simulator, and
// its transactions are signed by Xcode, which only a local hub started with APPLE_IAP_ACCEPT_XCODE=1
// takes. Builds made with xcodebuild, EAS and the store builds never read a scheme's Run action. iOS only.

const { withDangerousMod } = require('expo/config-plugins')
const { copyFileSync, existsSync, readFileSync, writeFileSync } = require('node:fs')
const path = require('node:path')

const STOREKIT_FILE = 'Rerun.storekit'
// Relative to the Xcode project, which sits next to the copied file.
const REFERENCE = `../${STOREKIT_FILE}`

function withStoreKitReference(scheme) {
    if (scheme.includes('<StoreKitConfigurationFileReference')) return scheme
    return scheme.replace(/(\n\s*)<\/LaunchAction>/, `$1   <StoreKitConfigurationFileReference$1      identifier = "${REFERENCE}">$1   </StoreKitConfigurationFileReference>$1</LaunchAction>`)
}

function withStoreKitConfig(config) {
    return withDangerousMod(config, [
        'ios',
        async config => {
            const { projectRoot, platformProjectRoot } = config.modRequest
            copyFileSync(path.join(projectRoot, STOREKIT_FILE), path.join(platformProjectRoot, STOREKIT_FILE))
            const scheme = path.join(platformProjectRoot, `${config.modRequest.projectName}.xcodeproj`, 'xcshareddata', 'xcschemes', `${config.modRequest.projectName}.xcscheme`)
            if (existsSync(scheme)) writeFileSync(scheme, withStoreKitReference(readFileSync(scheme, 'utf8')))
            return config
        },
    ])
}

module.exports = withStoreKitConfig
module.exports.withStoreKitReference = withStoreKitReference
