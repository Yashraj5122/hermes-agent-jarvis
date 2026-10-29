import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { test } from 'vitest'

import { collectDependencyNotices, renderDependencyNotices } from './generate-third-party-notices.mjs'

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-third-party-notices-'))
  const packages = {
    'apps/desktop': { dependencies: { 'with-license': '1.0.0', 'without-license-file': '2.0.0' } },
    'node_modules/with-license': { name: 'with-license', version: '1.0.0', license: 'MIT' },
    'node_modules/without-license-file': { name: 'without-license-file', version: '2.0.0', license: 'ISC' }
  }
  fs.mkdirSync(path.join(root, 'apps/desktop'), { recursive: true })
  fs.writeFileSync(path.join(root, 'apps/desktop/package.json'), JSON.stringify({ name: 'jarvis-test', version: '1.0.0' }))
  fs.mkdirSync(path.join(root, 'node_modules/with-license'), { recursive: true })
  fs.mkdirSync(path.join(root, 'node_modules/without-license-file'), { recursive: true })
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ packages }))
  fs.writeFileSync(path.join(root, 'node_modules/with-license/package.json'), JSON.stringify({
    name: 'with-license', version: '1.0.0', license: 'MIT', author: 'A. Author', repository: 'https://example.test/with-license'
  }))
  fs.writeFileSync(path.join(root, 'node_modules/with-license/LICENSE'), 'MIT license body')
  fs.writeFileSync(path.join(root, 'node_modules/without-license-file/package.json'), JSON.stringify({
    name: 'without-license-file', version: '2.0.0', license: 'ISC', author: 'B. Author'
  }))
  return root
}

test('dependency notices include full available texts and disclose missing package texts', () => {
  const root = fixture()

  try {
    const entries = collectDependencyNotices(root)
    const output = renderDependencyNotices(entries)

    assert.equal(entries.length, 2)
    assert.match(output, /with-license@1\.0\.0/)
    assert.match(output, /MIT license body/)
    assert.match(output, /without-license-file@2\.0\.0/)
    assert.match(output, /ISC/)
    assert.match(output, /Packages without full license text/)
    assert.match(output, /full license text was not found/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('dependency notices read a hoisted package license embedded in its README', () => {
  const root = fixture()

  try {
    const lockPath = path.join(root, 'package-lock.json')
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
    lock.packages['apps/desktop'].dependencies = { 'with-license': '1.0.0' }
    lock.packages['node_modules/with-license'].dependencies = { 'without-license-file': '2.0.0' }
    lock.packages['node_modules/with-license/node_modules/without-license-file'] = {
      version: '2.0.0', license: 'ISC'
    }
    fs.writeFileSync(lockPath, JSON.stringify(lock))
    fs.writeFileSync(path.join(root, 'node_modules/without-license-file/README.md'), [
      '# Package',
      '',
      '## License',
      '',
      'ISC License',
      '',
      'Copyright (c) 2023 B. Author',
      '',
      'Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.',
      '',
      'THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE.'
    ].join('\n'))

    const entries = collectDependencyNotices(root)
    const packageEntry = entries.find(item => item.name === 'without-license-file')

    assert.equal(entries.length, 2)
    assert.match(packageEntry.texts[0].text, /Copyright \(c\) 2023 B\. Author/)
    assert.match(renderDependencyNotices(entries), /Permission to use, copy, modify/)
    assert.doesNotMatch(renderDependencyNotices(entries), /full license text was not found/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('dependency notices read a setext-style License section from its README', () => {
  const root = fixture()

  try {
    const lockPath = path.join(root, 'package-lock.json')
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
    lock.packages['apps/desktop'].dependencies = { 'without-license-file': '2.0.0' }
    fs.writeFileSync(lockPath, JSON.stringify(lock))
    fs.writeFileSync(path.join(root, 'node_modules/without-license-file/README.md'), [
      'Package',
      '=======',
      '',
      'License',
      '-------',
      '',
      '(The MIT License)',
      '',
      'Copyright (c) 2024 B. Author',
      '',
      'Permission is granted under the MIT license.',
      '',
      'Usage',
      '-----',
      'Usage details must not be included in the license text.'
    ].join('\n'))

    const entry = collectDependencyNotices(root)[0]

    assert.match(entry.texts[0].text, /Copyright \(c\) 2024 B\. Author/)
    assert.doesNotMatch(entry.texts[0].text, /Usage details/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('dependency notices preserve npm aliases from their lockfile install path', () => {
  const root = fixture()

  try {
    const aliasDir = path.join(root, 'node_modules/with-license-v2')
    fs.mkdirSync(aliasDir)
    fs.writeFileSync(path.join(aliasDir, 'package.json'), JSON.stringify({
      name: 'with-license', version: '2.0.0', license: 'MIT'
    }))
    fs.writeFileSync(path.join(aliasDir, 'LICENSE'), 'MIT alias license body')

    const lockPath = path.join(root, 'package-lock.json')
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
    lock.packages['apps/desktop'].dependencies = { 'with-license-v2': '2.0.0' }
    lock.packages['node_modules/with-license-v2'] = {
      name: 'with-license', version: '2.0.0', license: 'MIT'
    }
    fs.writeFileSync(lockPath, JSON.stringify(lock))

    const entries = collectDependencyNotices(root)
    assert.deepEqual(entries.map(item => `${item.name}@${item.version}`), ['with-license@2.0.0'])
    assert.match(entries[0].texts[0].text, /MIT alias license body/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('dependency notices include a version-pinned source license override', () => {
  const root = fixture()

  try {
    const overrideDir = path.join(root, 'apps/desktop/scripts')
    fs.mkdirSync(overrideDir, { recursive: true })
    fs.writeFileSync(path.join(overrideDir, 'third-party-license-overrides.json'), JSON.stringify({
      'without-license-file@2.0.0': {
        license: 'ISC',
        source: 'https://example.test/commit/LICENSE',
        file: 'third-party-licenses/without-license-file.txt'
      }
    }))
    fs.mkdirSync(path.join(overrideDir, 'third-party-licenses'))
    fs.writeFileSync(path.join(overrideDir, 'third-party-licenses/without-license-file.txt'), 'ISC license from pinned source')

    const entries = collectDependencyNotices(root)
    const entry = entries.find(item => item.name === 'without-license-file')
    const output = renderDependencyNotices(entries)

    assert.match(entry.texts[0].text, /ISC license from pinned source/)
    assert.match(output, /License source: https:\/\/example\.test\/commit\/LICENSE/)
    assert.doesNotMatch(output, /full license text was not found/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('dependency notice collection rejects a third-party package with unknown license metadata', () => {
  const root = fixture()

  try {
    const file = path.join(root, 'node_modules/without-license-file/package.json')
    fs.writeFileSync(file, JSON.stringify({ name: 'without-license-file', version: '2.0.0' }))
    const lockPath = path.join(root, 'package-lock.json')
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
    delete lock.packages['node_modules/without-license-file'].license
    fs.writeFileSync(lockPath, JSON.stringify(lock))
    assert.throws(() => collectDependencyNotices(root), /unknown license metadata/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
