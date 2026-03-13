/** @type {import('jest').Config} */
module.exports = {
    // jsdom provides a browser-like environment (window, document, localStorage, etc.)
    testEnvironment: 'jest-environment-jsdom',

    // Only pick up files inside the dedicated tests/ directory
    testMatch: ['<rootDir>/tests/**/*.test.ts'],

    // Use ts-jest to transpile TypeScript test files on the fly.
    // Passing the tsconfig here is the non-deprecated approach (replaces globals.ts-jest).
    transform: {
        '^.+\\.tsx?$': ['ts-jest', {
            // Point ts-jest at the test-specific tsconfig so the compiler options are
            // compatible with CommonJS modules (Jest cannot load ES2020 modules natively)
            tsconfig: '<rootDir>/tsconfig.test.json',
        }],
    },

    // Collect coverage from the TypeScript source files under frontend/
    collectCoverageFrom: [
        'frontend/**/*.ts',
        '!frontend/globals.d.ts',
        '!frontend/types.ts',
    ],
};
