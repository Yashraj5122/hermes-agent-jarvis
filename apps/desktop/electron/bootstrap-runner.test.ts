import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { test } from 'vitest'

import {
  buildPinArgs,
  buildPosixPinArgs,
  cachedScriptPath,
  cleanInstallerLogLine,
  githubRawContentUrl,
  hasExistingGitCheckout,
  installerEnv,
  installRefForStamp,
  isPinnedCommit,
  resolveInstallScript,
  resolveMarkerPinnedCommit,
  runBootstrap
} from './bootstrap-runner'

const SCRIPT_NAME = process.platform === 'win32' ? 'install.ps1' : 'install.sh'
const ZERO_COMMIT = '0000000000000000000000000000000000000000'

function mkTmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-bootstrap-test-'))
}

test('runBootstrap bails immediately when the signal is already aborted', async () => {
  const controller = new AbortController()
  controller.abort()

  const events = []

  const result = await runBootstrap({
    installStamp: null,
    activeRoot: '/tmp/hermes-runner-test',
    sourceRepoRoot: null,
    hermesHome: '/tmp/hermes-runner-test',
    logRoot: '/tmp/hermes-runner-test',
    onEvent: ev => events.push(ev),
    abortSignal: controller.signal
  })

  // Cancelled before any install script is spawned.
  assert.deepEqual(result, { ok: false, cancelled: true })
  assert.ok(
    events.some(ev => ev.type === 'failed' && /cancelled/i.test(ev.error)),
    'should emit a cancelled failure event'
  )
})

test('existing checkout detection requires git metadata', () => {
  const home = mkTmpHome()

  try {
    const activeRoot = path.join(home, 'hermes-agent')
    assert.equal(hasExistingGitCheckout(activeRoot), false)

    fs.mkdirSync(path.join(activeRoot, '.git'), { recursive: true })
    assert.equal(hasExistingGitCheckout(activeRoot), true)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('fresh bootstrap args include the packaged commit pin', () => {
  const installStamp = { commit: 'a'.repeat(40), branch: 'main' }

  assert.deepEqual(buildPinArgs(installStamp), ['-Commit', installStamp.commit, '-Branch', 'main'])
  assert.deepEqual(
    buildPosixPinArgs({
      installStamp,
      activeRoot: '/tmp/hermes-agent',
      hermesHome: '/tmp/hermes'
    }),
    ['--dir', '/tmp/hermes-agent', '--hermes-home', '/tmp/hermes', '--branch', 'main', '--commit', installStamp.commit]
  )
})

test('Jarvis bootstrap fetches and installs its separately pinned upstream runtime', () => {
  const stamp = {
    commit: 'c'.repeat(40),
    branch: 'jarvis/setup',
    runtimeBootstrap: { commit: '74195d3680784111a58ce6643e16c7bd082a40a7', branch: 'main' }
  }

  assert.deepEqual(installRefForStamp(stamp), {
    ref: stamp.runtimeBootstrap.commit,
    cacheKey: stamp.runtimeBootstrap.commit,
    pinned: true
  })
  assert.deepEqual(buildPosixPinArgs({ installStamp: stamp, activeRoot: '/tmp/hermes', hermesHome: '/tmp/home' }), [
    '--dir',
    '/tmp/hermes',
    '--hermes-home',
    '/tmp/home',
    '--branch',
    'main',
    '--commit',
    stamp.runtimeBootstrap.commit
  ])
  assert.deepEqual(buildPinArgs(stamp), ['-Commit', stamp.runtimeBootstrap.commit, '-Branch', 'main'])
  assert.deepEqual(
    buildPosixPinArgs({ installStamp: stamp, activeRoot: '/tmp/hermes', hermesHome: '/tmp/home', pinCommit: false }),
    ['--dir', '/tmp/hermes', '--hermes-home', '/tmp/home', '--branch', 'main']
  )
  assert.deepEqual(buildPinArgs(stamp, { pinCommit: false }), ['-Branch', 'main'])
})

test('Jarvis bootstrap fetches its installer from the pinned runtime repository', async () => {
  const home = mkTmpHome()
  const repository = 'https://github.com/Yashraj5122/hermes-agent-jarvis.git'
  const downloaded = []

  try {
    await resolveInstallScript({
      installStamp: {
        commit: 'c'.repeat(40),
        branch: 'jarvis/setup',
        runtimeBootstrap: {
          commit: 'd'.repeat(40),
          branch: 'jarvis/setup',
          repository
        }
      },
      sourceRepoRoot: null,
      hermesHome: home,
      emit: () => {},
      _download: async (...args) => downloaded.push(args)
    })

    assert.equal(downloaded[0][0], 'd'.repeat(40))
    assert.equal(downloaded[0][2], repository)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('runtime repository generates a GitHub raw URL and is forwarded to the installer', () => {
  const repository = 'https://github.com/Yashraj5122/hermes-agent-jarvis.git'
  const originalRepository = process.env.HERMES_REPO_URL

  try {
    delete process.env.HERMES_REPO_URL
    assert.equal(
      githubRawContentUrl(repository, 'a'.repeat(40), 'scripts/install.sh'),
      `https://raw.githubusercontent.com/Yashraj5122/hermes-agent-jarvis/${'a'.repeat(40)}/scripts/install.sh`
    )
    assert.equal(installerEnv('/tmp/jarvis-home', repository).HERMES_REPO_URL, repository)
    assert.throws(() => githubRawContentUrl('http://example.com/owner/repo', 'main', 'scripts/install.sh'))
  } finally {
    if (originalRepository === undefined) {delete process.env.HERMES_REPO_URL}
    else {process.env.HERMES_REPO_URL = originalRepository}
  }
})

test('runtime repository rejects credential-like URL components without echoing them', () => {
  for (const repository of [
    'https://github.com/Yashraj5122/hermes-agent-jarvis.git?token=secret-value',
    'https://github.com/Yashraj5122/hermes-agent-jarvis.git#secret-value',
    'https://user:secret-value@github.com/Yashraj5122/hermes-agent-jarvis.git'
  ]) {
    assert.throws(
      () => githubRawContentUrl(repository, 'a'.repeat(40), 'scripts/install.sh'),
      (error: Error) => !error.message.includes('secret-value') && /HTTPS GitHub repository/.test(error.message)
    )
  }
})

test('bootstrap does not log an unsafe environment repository URL', async () => {
  const home = mkTmpHome()
  const originalRepository = process.env.HERMES_REPO_URL
  const events = []

  try {
    process.env.HERMES_REPO_URL = 'https://github.com/Yashraj5122/hermes-agent-jarvis.git?token=secret-value'
    await assert.rejects(
      resolveInstallScript({
        installStamp: { commit: 'c'.repeat(40), branch: 'main' },
        sourceRepoRoot: null,
        hermesHome: home,
        emit: event => events.push(event.line || ''),
        _download: async (ref, _path, repository) => githubRawContentUrl(repository, ref, 'scripts/install.sh')
      }),
      /HTTPS GitHub repository/
    )
    assert.doesNotMatch(events.join('\n'), /secret-value/)
  } finally {
    if (originalRepository === undefined) {delete process.env.HERMES_REPO_URL}
    else {process.env.HERMES_REPO_URL = originalRepository}

    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('existing-checkout bootstrap args keep branch but skip the packaged commit pin', () => {
  const installStamp = { commit: 'a'.repeat(40), branch: 'main' }

  assert.deepEqual(buildPinArgs(installStamp, { pinCommit: false }), ['-Branch', 'main'])
  assert.deepEqual(
    buildPosixPinArgs({
      installStamp,
      activeRoot: '/tmp/hermes-agent',
      hermesHome: '/tmp/hermes',
      pinCommit: false
    }),
    ['--dir', '/tmp/hermes-agent', '--hermes-home', '/tmp/hermes', '--branch', 'main']
  )
})

test('fallback install stamps use an unpinned branch ref', () => {
  const stamp = { commit: ZERO_COMMIT, branch: 'main' }

  assert.equal(isPinnedCommit(ZERO_COMMIT), false)
  assert.deepEqual(installRefForStamp(stamp), {
    ref: 'main',
    cacheKey: 'branch-main',
    pinned: false
  })
  // Must NOT pass -Commit / --commit for the all-zero placeholder.
  assert.deepEqual(buildPinArgs(stamp), ['-Branch', 'main'])
  assert.deepEqual(
    buildPosixPinArgs({
      installStamp: stamp,
      activeRoot: '/tmp/hermes',
      hermesHome: '/tmp/home'
    }),
    ['--dir', '/tmp/hermes', '--hermes-home', '/tmp/home', '--branch', 'main']
  )
})

test('existing-checkout installer ref follows the branch instead of the packaged commit', () => {
  const stamp = { commit: 'a'.repeat(40), branch: 'main' }

  assert.deepEqual(installRefForStamp(stamp, { pinCommit: false }), {
    ref: 'main',
    cacheKey: 'branch-main',
    pinned: false
  })
  assert.deepEqual(installRefForStamp(stamp), {
    ref: stamp.commit,
    cacheKey: stamp.commit,
    pinned: true
  })
})

test('resolveMarkerPinnedCommit prefers installed checkout HEAD over the packaged artifact', () => {
  const realHead = 'c'.repeat(40)
  assert.equal(
    resolveMarkerPinnedCommit({ commit: ZERO_COMMIT, branch: 'main' }, '/tmp/checkout', {
      resolveHead: () => realHead
    }),
    realHead
  )
  assert.equal(
    resolveMarkerPinnedCommit({ commit: 'd'.repeat(40), branch: 'main' }, '/tmp/checkout', {
      resolveHead: () => realHead
    }),
    realHead,
    'the installed checkout owns source runtime identity'
  )
  assert.equal(
    resolveMarkerPinnedCommit({ commit: ZERO_COMMIT, branch: 'main' }, '/tmp/missing', {
      resolveHead: () => null
    }),
    null
  )
})

test('resolveMarkerPinnedCommit uses the runtime pin when no checkout head is available', () => {
  const runtimeCommit = '74195d3680784111a58ce6643e16c7bd082a40a7'
  assert.equal(
    resolveMarkerPinnedCommit(
      { commit: 'c'.repeat(40), runtimeBootstrap: { commit: runtimeCommit, branch: 'main' } },
      null,
      {
        resolveHead: () => null
      }
    ),
    runtimeCommit
  )
})

test('resolveInstallScript downloads fallback stamps by branch instead of zero commit', async () => {
  const home = mkTmpHome()

  try {
    const cached = cachedScriptPath(home, 'branch-main')
    fs.mkdirSync(path.dirname(cached), { recursive: true })
    fs.writeFileSync(cached, 'stale branch installer\n')

    const refs = []

    const result = await resolveInstallScript({
      installStamp: { commit: ZERO_COMMIT, branch: 'main' },
      sourceRepoRoot: null,
      hermesHome: home,
      emit: () => {},
      _download: async (ref, destPath) => {
        refs.push(ref)
        fs.mkdirSync(path.dirname(destPath), { recursive: true })
        fs.writeFileSync(destPath, '#!/bin/sh\necho fallback branch\n')

        return destPath
      }
    })

    assert.deepEqual(refs, ['main'])
    assert.equal(result.source, 'download')
    assert.equal(result.commit, null)
    assert.equal(result.path, cached)
    assert.match(fs.readFileSync(cached, 'utf8'), /fallback branch/)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('resolveInstallScript refreshes the live branch for an existing checkout', async () => {
  const home = mkTmpHome()

  try {
    const commit = 'a'.repeat(40)
    const cached = cachedScriptPath(home, 'branch-main')
    fs.mkdirSync(path.dirname(cached), { recursive: true })
    fs.writeFileSync(cached, 'stale installer\n')

    const refs = []

    const result = await resolveInstallScript({
      installStamp: { commit, branch: 'main' },
      sourceRepoRoot: null,
      hermesHome: home,
      emit: () => {},
      pinCommit: false,
      _download: async (ref, destPath) => {
        refs.push(ref)
        fs.writeFileSync(destPath, 'fresh branch installer\n')

        return destPath
      }
    })

    assert.deepEqual(refs, ['main'])
    assert.equal(result.source, 'download')
    assert.equal(result.commit, null)
    assert.equal(result.path, cached)
    assert.equal(fs.readFileSync(cached, 'utf8'), 'fresh branch installer\n')
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('resolveInstallScript refreshes an immutable-pin cache on a fresh install', async () => {
  const home = mkTmpHome()

  try {
    const commit = 'a'.repeat(40)
    const cached = cachedScriptPath(home, commit)
    fs.mkdirSync(path.dirname(cached), { recursive: true })
    fs.writeFileSync(cached, 'stale installer\n')

    const refs = []

    const result = await resolveInstallScript({
      installStamp: { commit, branch: 'main' },
      sourceRepoRoot: null,
      hermesHome: home,
      emit: () => {},
      _download: async (ref, destPath) => {
        refs.push(ref)
        fs.writeFileSync(destPath, 'fresh pinned installer\n')

        return destPath
      }
    })

    assert.deepEqual(refs, [commit])
    assert.equal(result.source, 'download')
    assert.equal(result.commit, commit)
    assert.equal(result.path, cached)
    assert.equal(fs.readFileSync(cached, 'utf8'), 'fresh pinned installer\n')
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('resolveInstallScript fails closed instead of executing an installed stale script', async () => {
  const home = mkTmpHome()

  try {
    const commit = 'a'.repeat(40)
    const scriptsDir = path.join(home, 'hermes-agent', 'scripts')
    fs.mkdirSync(scriptsDir, { recursive: true })
    fs.writeFileSync(path.join(scriptsDir, SCRIPT_NAME), 'stale installed script\n')

    await assert.rejects(
      resolveInstallScript({
        installStamp: { commit, branch: 'main' },
        sourceRepoRoot: null,
        hermesHome: home,
        emit: () => {},
        _download: async () => {
          throw new Error('Failed to download install script: HTTP 404')
        }
      }),
      /HTTP 404/
    )
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

// #112675: install.sh colours its banners and curl/uv redraw progress with \r
// even into a pipe; the overlay renders lines as plain text, so the emitter
// must hand every consumer (log ring, Details panel, Copy output) the text a
// terminal would be left showing.
test('installer log lines reach the emitter without escape sequences; \\r redraws keep the last frame', () => {
  assert.equal(cleanInstallerLogLine('\u001b[0;32m✓\u001b[0m Detected: macos (macos)'), '✓ Detected: macos (macos)')
  assert.equal(cleanInstallerLogLine('\u001b[2K\u001b[1GCloning repository…\u001b[K'), 'Cloning repository…')
  assert.equal(cleanInstallerLogLine('\u001b]0;hermes\u0007Installing Hermes'), 'Installing Hermes')
  assert.equal(cleanInstallerLogLine('\r 12%\r 67%\r100%\u001b[K'), '100%')
  assert.equal(cleanInstallerLogLine('Resolving dependencies…\r'), 'Resolving dependencies…')
  // Only-escape frames drop entirely, so the caller emits nothing for them.
  assert.equal(cleanInstallerLogLine('\u001b[0m\r'), '')
  // Plain multi-byte text is untouched.
  assert.equal(cleanInstallerLogLine('Ready — café ✓ 中文'), 'Ready — café ✓ 中文')
})

test.skipIf(process.platform === 'win32')(
  'a manifest-step failure surfaces the installer tail without escape sequences',
  async () => {
    const home = mkTmpHome()
    fs.mkdirSync(path.join(home, 'scripts'))
    fs.writeFileSync(
      path.join(home, 'scripts', 'install.sh'),
      '#!/usr/bin/env bash\nprintf "\\033[0;31m\\xe2\\x9c\\x97\\033[0m manifest broke\\n" >&2\nexit 3\n'
    )

    const result = await runBootstrap({
      installStamp: null,
      activeRoot: home,
      sourceRepoRoot: home,
      hermesHome: home,
      logRoot: home,
      onEvent: () => {}
    })

    assert.equal(result.ok, false)
    assert.equal(result.error, 'install.sh --manifest failed: exit 3\n✗ manifest broke')
  }
)
