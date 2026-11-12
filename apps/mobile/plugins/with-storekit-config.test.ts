const { withStoreKitReference } = require('./with-storekit-config')

const SCHEME = `<Scheme>
   <LaunchAction
      buildConfiguration = "Debug">
      <BuildableProductRunnable>
      </BuildableProductRunnable>
   </LaunchAction>
   <ProfileAction>
   </ProfileAction>
</Scheme>`

describe('withStoreKitReference', () => {
    it('names Rerun.storekit in the Run action, once', () => {
        const once = withStoreKitReference(SCHEME)
        expect(once).toContain('<StoreKitConfigurationFileReference\n         identifier = "../Rerun.storekit">\n      </StoreKitConfigurationFileReference>\n   </LaunchAction>')
        expect(withStoreKitReference(once)).toBe(once)
        expect(once.indexOf('StoreKitConfigurationFileReference')).toBeLessThan(once.indexOf('<ProfileAction>'))
    })
})
