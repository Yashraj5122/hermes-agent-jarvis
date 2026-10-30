import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

import { patchAppRunSandboxProbe } from './patch-electron-builder-appimage-sandbox.mjs'

const require = createRequire(import.meta.url)
const appBuilderLib = require.resolve('app-builder-lib')
const appImageUtil = await import(pathToFileURL(path.join(path.dirname(appBuilderLib), 'targets/linux/appimage/appImageUtil.js')))

test('Jarvis AppRun never converts a denied userns probe into --no-sandbox', () => {
  const template = appImageUtil.generateAppRunScript({ ExecutableName: 'Jarvis' })
  const patched = patchAppRunSandboxProbe(template)

  assert.match(patched, /NO_SANDBOX=\(\)/)
  assert.doesNotMatch(patched, /&& ! unshare -Ur true/)
  assert.doesNotMatch(patched, /NO_SANDBOX=\(--no-sandbox\)/)
  assert.match(patched, /"\$\{EXECUTABLE_ARGS\[@\]\}"/)
})

test('the AppRun adapter rejects an upstream template that changed', () => {
  assert.throws(() => patchAppRunSandboxProbe('NO_SANDBOX=()\n'), /template changed/)
})
