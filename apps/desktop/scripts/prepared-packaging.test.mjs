import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, test } from 'vitest'
import * as prepared from './prepared-packaging.mjs'
import { validatePreparedBuilderArgs } from './run-electron-builder.mjs'
import { spawnSync } from 'node:child_process'

/** @type {string[]} */
const roots = []
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })))

/** @returns {{ source: string, out: string, electron: string, sevenZip: string, icons: string }} */
function fixture() {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), 'prepared-packager-'))
  roots.push(source)
  const out = path.join(source, 'work')
  fs.mkdirSync(path.join(source, 'apps/desktop'), { recursive: true })
  fs.writeFileSync(path.join(source, 'package-lock.json'), '{}')
  fs.writeFileSync(path.join(source, 'apps/desktop/package.json'), '{}')
  fs.writeFileSync(path.join(source, 'apps/desktop/electron-builder.config.cjs'), 'module.exports = {}')
  const electron = path.join(out, 'electron.zip')
  const sevenZip = path.join(out, 'sevenZip')
  const icons = path.join(out, 'icons')
  fs.mkdirSync(path.join(sevenZip, 'bin'), { recursive: true })
  fs.mkdirSync(icons)
  fs.writeFileSync(electron, 'verified archive fixture')
  fs.writeFileSync(path.join(sevenZip, 'bin', process.platform === 'win32' ? '7za.exe' : '7za'), 'archive utility fixture')
  fs.writeFileSync(path.join(icons, 'icon-tool.js'), 'icon tool fixture')
  return { source, out, electron, sevenZip, icons }
}

test.runIf(process.platform === 'linux')('prepared icon tools retain CommonJS inside an ESM workspace', () => {
  const inputs = fixture()
  fs.writeFileSync(path.join(inputs.source, 'package.json'), '{"type":"module"}')
  fs.writeFileSync(path.join(inputs.icons, 'icon-tool.js'), 'require("node:fs"); console.log("commonjs-icon-ready")')
  const lock = { packages: {} }
  for (const name of ['app-builder-lib', 'electron-builder']) {
    const root = path.join(inputs.source, 'node_modules', name)
    fs.mkdirSync(path.join(root, 'dist'), { recursive: true })
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name, version: '1.0.0', type: 'module', main: 'dist/index.js' }))
    fs.writeFileSync(path.join(root, 'dist/index.js'), 'export {}')
    lock.packages[`node_modules/${name}`] = { version: '1.0.0' }
  }
  fs.writeFileSync(path.join(inputs.source, 'package-lock.json'), JSON.stringify(lock))
  const dist = path.join(inputs.source, 'node_modules/app-builder-lib/dist')
  for (const [file, method, value] of [
    ['util/electronGet.js', 'downloadElectronArtifactZip', inputs.electron],
    ['toolsets/7zip.js', 'getPath7za', path.join(inputs.sevenZip, 'bin/7za')],
    ['toolsets/icons.js', 'getIconsToolsetPath', inputs.icons],
  ]) {
    fs.mkdirSync(path.dirname(path.join(dist, file)), { recursive: true })
    fs.writeFileSync(path.join(dist, file), `export function ${method}() { return ${JSON.stringify(value)} }`)
  }
  const out = path.join(inputs.source, 'prepared')
  const preparation = spawnSync(process.execPath, [path.join(import.meta.dirname, 'prepare-packaging-tools.mjs'),
    '--source', inputs.source, '--out', out, '--cache', path.join(inputs.source, 'cache'), '--format', 'dir'], { encoding: 'utf8' })
  assert.equal(preparation.status, 0, preparation.stderr)
  const icon = spawnSync(process.execPath, [path.join(out, 'icons/icon-tool.js')], { encoding: 'utf8' })
  assert.equal(icon.status, 0, icon.stderr)
  assert.equal(icon.stdout.trim(), 'commonjs-icon-ready')
})

test('a failed preparation invalidates an earlier completion claim before loading suppliers', () => {
  const { source, out } = fixture()
  const manifest = path.join(out, 'prepared.json')
  fs.writeFileSync(manifest, '{}')
  const result = spawnSync(process.execPath, [path.join(import.meta.dirname, 'prepare-packaging-tools.mjs'),
    '--source', source, '--out', out, '--cache', path.join(source, 'cache')], { encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.equal(fs.existsSync(manifest), false)
  assert.match(result.stderr, /lock|install|pinned/i)
})

test('prepared inputs are path-bound and reject changed or missing bytes without repair', async () => {
  const inputs = fixture()
  const manifest = await prepared.publishPackagingInputs({
    ...inputs, target: 'linux-x64', formats: ['dir'],
    toolsets: { sevenZip: inputs.sevenZip, icons: inputs.icons },
  })
  const result = prepared.readPackagingInputs(manifest, inputs.source, 'linux-x64')
  assert.equal(result.electron, inputs.electron)
  assert.throws(() => validatePreparedBuilderArgs([], result), /run preparation again/)
  assert.throws(() => validatePreparedBuilderArgs(['--dir', '-c.electronDist=/another.zip'], result), /run preparation again/)
  validatePreparedBuilderArgs(['--dir', '-c.extraMetadata.version=1.2.3'], result)
  fs.writeFileSync(inputs.electron, 'corrupt')
  assert.throws(() => prepared.readPackagingInputs(manifest, inputs.source, 'linux-x64'), /run preparation again/i)
  assert.equal(fs.readFileSync(inputs.electron, 'utf8'), 'corrupt')
  fs.rmSync(inputs.electron)
  assert.throws(() => prepared.readPackagingInputs(manifest, inputs.source, 'linux-x64'), /run preparation again/i)
})
