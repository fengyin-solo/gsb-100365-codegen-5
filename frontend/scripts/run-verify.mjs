// 打包并运行验证脚本：把 @/ 别名解析到 src，TS 直接转 JS。
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const outfile = join(tmpdir(), 'verify-batch.mjs')

await build({
  entryPoints: ['scripts/verify-batch.mts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  alias: { '@': new URL('../src', import.meta.url).pathname },
  logLevel: 'silent',
})

await import(pathToFileURL(outfile).href)
