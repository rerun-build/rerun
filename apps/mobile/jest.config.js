// `@rerun/cloud-mobile/*` resolves in jest.resolver.js, module by module, like the `paths` of tsconfig.json.
// Every test runs as iOS and as Android: a control with a `.android.tsx` twin is tested on both sides.
const shared = {
    "resolver": "./jest.resolver.js",
    "setupFiles": [
        "react-native-gesture-handler/jestSetup.js",
        "./jest.setup.js"
    ],
    "transformIgnorePatterns": [
        "node_modules/(?!(.pnpm|(jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|native-base|react-native-svg|marked|remend|use-intl|intl-messageformat|@formatjs/.*|icu-minify|@schummar/.*))"
    ],
    // The native build keeps its Swift packages under .expo/ (expo-iap's OpenIAP checkout comes with
    // tests of its own): only the app's tests are the app's to run.
    "testPathIgnorePatterns": ["/node_modules/", "<rootDir>/.expo/", "<rootDir>/ios/", "<rootDir>/android/"],
    "modulePathIgnorePatterns": ["<rootDir>/.expo/"],
    "moduleNameMapper": {
        "^remend$": "<rootDir>/node_modules/remend/dist/index.js"
    }
}

module.exports = {
    "projects": [
        { ...shared, "displayName": "ios", "preset": "jest-expo/ios" },
        { ...shared, "displayName": "android", "preset": "jest-expo/android" }
    ]
}
