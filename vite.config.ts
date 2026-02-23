/// <reference types="vitest" />
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
    build: {
        target: 'node22',
        lib: {
            entry: {
                index: resolve(__dirname, 'src/index.ts'),
                cli: resolve(__dirname, 'src/cli.ts'),
            },
            name: 'TdnetTs',
            formats: ['es', 'cjs'],
        },
        rollupOptions: {
            external: [
                'node:sqlite',
                'node:path',
                'node:fs',
                'node:url',
                'node:util',
                '@opendocsg/pdf2md'
            ],
        },
        ssr: true, // Node.js環境用のビルドとする
    },
    test: {
        globals: true,
        environment: 'node',
        include: ['tests/**/*.test.ts'],
    }
});
