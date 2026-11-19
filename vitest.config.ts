import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        // Only run TypeScript test sources. Exclude any compiled JS that may
        // exist alongside (e.g. in dist/) — vitest 4 errors on CommonJS test
        // files that vitest 3 silently ignored.
        include: ['test/**/*.test.ts'],
        exclude: ['node_modules/**', 'dist/**', 'integ/**'],
    },
})
