import resolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';

const production = !process.env.ROLLUP_WATCH;

export default {
    input: 'src/app.ts',
    output: {
        file: 'app.js',
        format: 'iife',
        sourcemap: !production
    },
    plugins: [
        resolve(),
        typescript(),
        production && terser()
    ]
};
