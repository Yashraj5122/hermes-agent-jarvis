import assert from 'node:assert/strict'
import { test } from 'vitest'

import { packagedExecutableName } from './packaged-executable-name.mjs'

test('packaged executable name follows the product identity on Linux', () => {
  assert.equal(packagedExecutableName({ displayName: 'Jarvis', windowsExecutableName: 'Jarvis' }, 'linux'), 'Jarvis')
})

test('packaged executable name uses the Windows executable identity', () => {
  assert.equal(
    packagedExecutableName({ displayName: 'Jarvis 123abcd', windowsExecutableName: 'hermes-123abcd' }, 'win32'),
    'hermes-123abcd'
  )
})
