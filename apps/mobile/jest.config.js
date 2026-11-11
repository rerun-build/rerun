// `@rerun/cloud-mobile/*` resolves in jest.resolver.js, module by module, like the `paths` of tsconfig.json.
module.exports = {
    "preset": "jest-expo",
    "resolver": "./jest.resolver.js",
    "setupFiles": [
        "react-native-gesture-handler/jestSetup.js",
        "./jest.setup.js"
    ],
    "transformIgnorePatterns": [
        "node_modules/(?!(.pnpm|(jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|native-base|react-native-svg|marked|remend|use-intl|intl-messageformat|@formatjs/.*|icu-minify|@schummar/.*))"
    ],
    "moduleNameMapper": {
        "^remend$": "<rootDir>/node_modules/remend/dist/index.js"
    }
}
