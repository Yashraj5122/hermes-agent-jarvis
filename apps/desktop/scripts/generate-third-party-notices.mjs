#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const LICENSE_FILE_RE = /^(license|licence|copying|notice)(?:[._-].*)?$/i

function resolveDependency(packages, from, name) {
  let parent = from

  while (true) {
    const candidate = parent ? `${parent}/node_modules/${name}` : `node_modules/${name}`

    if (packages[candidate]) return candidate

    const nested = parent.lastIndexOf('/node_modules/')

    if (nested >= 0) parent = parent.slice(0, nested)
    else if (parent.startsWith('node_modules/')) parent = ''
    else if (parent) parent = parent.includes('/') ? parent.slice(0, parent.lastIndexOf('/')) : ''
    else return null
  }
}

function resolveInstalledDependency(root, lockPath, from, name, version) {
  const lockCandidate = path.join(root, lockPath)
  const lockManifestPath = path.join(lockCandidate, 'package.json')
  if (fs.existsSync(lockManifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(lockManifestPath, 'utf8'))
    if (manifest.name === name && (!version || manifest.version === version)) return lockCandidate
  }

  let parent = path.join(root, from)
  const segments = name.split('/')

  while (parent.startsWith(root)) {
    const candidate = path.join(parent, 'node_modules', ...segments)
    const manifestPath = path.join(candidate, 'package.json')

    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
      if (manifest.name === name && manifest.version === version) return candidate
    }

    if (parent === root) break
    parent = path.dirname(parent)
  }

  return null
}

function readLicenseFiles(packageDir) {
  if (!fs.existsSync(packageDir)) return []

  const paths = []
  const visit = (directory, depth) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      if (entry.isFile() && LICENSE_FILE_RE.test(entry.name)) paths.push(absolute)
      else if (entry.isDirectory() && depth > 0 && /^(licenses|license)$/i.test(entry.name)) visit(absolute, depth - 1)
    }
  }

  visit(packageDir, 1)
  return paths.sort()
}

function readReadmeLicense(packageDir) {
  const readme = fs.readdirSync(packageDir, { withFileTypes: true })
    .find(entry => entry.isFile() && /^readme(?:\..*)?$/i.test(entry.name))
  if (!readme) return null

  const lines = fs.readFileSync(path.join(packageDir, readme.name), 'utf8').split(/\r?\n/)
  let start = -1
  let contentStart = -1
  let level = 0
  for (let index = 0; index < lines.length; index++) {
    const markdown = lines[index].match(/^(#{1,6})\s+licen[cs]e\b/i)
    const setext = /^licen[cs]e\s*$/i.test(lines[index]) && /^[-=]{3,}\s*$/.test(lines[index + 1] || '')
    if (markdown || setext) {
      start = index
      level = markdown ? markdown[1].length : lines[index + 1].trim()[0] === '=' ? 1 : 2
      contentStart = index + (markdown ? 1 : 2)
      break
    }
  }
  if (start < 0) return null

  let end = lines.length
  for (let index = contentStart; index < lines.length; index++) {
    const markdown = lines[index].match(/^(#{1,6})\s/)
    const setext = index + 1 < lines.length && /^[-=]{3,}\s*$/.test(lines[index + 1])
    const setextLevel = setext ? lines[index + 1].trim()[0] === '=' ? 1 : 2 : Infinity
    if (markdown && markdown[1].length <= level || setext && setextLevel <= level) {
      end = index
      break
    }
  }

  const text = lines.slice(contentStart, end).join('\n').trim()
  return inferLicense(text) ? { file: `${readme.name} (license section)`, text } : null
}

function inferLicense(text) {
  if (/\bThe MIT License\b|\bMIT License\b/i.test(text)) return 'MIT'
  if (/\bISC License\b/i.test(text)) return 'ISC'
  if (/\bBSD 3-Clause License\b/i.test(text)) return 'BSD-3-Clause'
  if (/Mozilla Public License Version 2\.0/i.test(text)) return 'MPL-2.0'
  return null
}

function authorText(author) {
  if (Array.isArray(author)) return author.map(authorText).filter(Boolean).join(', ')
  if (typeof author === 'string') return author.trim()
  if (!author || typeof author !== 'object') return ''
  return [author.name, author.email && `<${author.email}>`, author.url && `(${author.url})`].filter(Boolean).join(' ')
}

function repositoryUrl(repository) {
  if (typeof repository === 'string') return repository.replace(/^git\+/, '').replace(/^git:/, 'https:')
  if (repository && typeof repository.url === 'string') return repositoryUrl(repository.url)
  return ''
}

function isWorkspacePath(root, packageDir, lockEntry) {
  const relative = path.relative(root, fs.realpathSync(packageDir)).split(path.sep).join('/')
  return /^(apps|packages)\//.test(relative) || typeof lockEntry.resolved === 'string' && /^(apps|packages)\//.test(lockEntry.resolved)
}

/** Collect the installed production/optional dependency closure from npm's lockfile. */
export function collectDependencyNotices(root) {
  root = path.resolve(root)
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'))
  const packages = lock.packages
  const overrideDir = path.join(root, 'apps/desktop/scripts')
  const overridePath = path.join(overrideDir, 'third-party-license-overrides.json')
  const overrides = fs.existsSync(overridePath) ? JSON.parse(fs.readFileSync(overridePath, 'utf8')) : {}

  if (!packages || !packages['apps/desktop']) throw new Error('package-lock.json has no apps/desktop workspace entry')

  const queue = ['apps/desktop']
  const visited = new Set()
  const entries = new Map()

  while (queue.length) {
    const key = queue.pop()
    if (visited.has(key)) continue
    visited.add(key)

    const lockEntry = packages[key]
    if (!lockEntry) continue
    const nameFromKey = lockEntry.name || key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length)
    const packageDir = key === 'apps/desktop'
      ? path.join(root, key)
      : resolveInstalledDependency(
        root,
        key,
        key.slice(0, Math.max(0, key.lastIndexOf('/node_modules/'))),
        nameFromKey,
        lockEntry.version
      )
    if (!packageDir) continue // Optional package for another OS/CPU target.

    const manifestPath = path.join(packageDir, 'package.json')
    if (!fs.existsSync(manifestPath)) throw new Error(`Dependency has no package.json: ${key}`)
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    const name = manifest.name || lockEntry.name
    const version = manifest.version || lockEntry.version

    for (const dependency of Object.keys({
      ...lockEntry.dependencies,
      ...lockEntry.optionalDependencies,
      ...lockEntry.peerDependencies
    })) {
      const child = resolveDependency(packages, key, dependency)
      if (child) queue.push(child)
    }

    if (!name || !version || isWorkspacePath(root, packageDir, lockEntry)) continue

    const licenseFiles = readLicenseFiles(packageDir)
    const texts = licenseFiles.map(file => ({ file: path.basename(file), text: fs.readFileSync(file, 'utf8').trim() }))
    if (!texts.length) {
      const readmeLicense = readReadmeLicense(packageDir)
      if (readmeLicense) texts.push(readmeLicense)
    }
    const license = manifest.license || lockEntry.license || texts.map(({ text }) => inferLicense(text)).find(Boolean)
    const override = overrides[`${name}@${version}`]

    if (!license) throw new Error(`Dependency has unknown license metadata: ${name}@${version} (${key})`)

    let licenseSource = ''
    if (override) {
      if (override.license !== license) throw new Error(`License override disagrees with package metadata: ${name}@${version}`)
      if (!override.source || !override.file || path.isAbsolute(override.file) || override.file.split(/[\\/]/).includes('..')) {
        throw new Error(`Invalid license override source or file: ${name}@${version}`)
      }
      const file = path.join(overrideDir, override.file)
      if (!fs.existsSync(file)) throw new Error(`License override file is missing: ${name}@${version} (${file})`)
      texts.push({ file: path.basename(file), text: fs.readFileSync(file, 'utf8').trim() })
      licenseSource = override.source
    }

    const id = `${name}@${version}`
    const existing = entries.get(id)
    const entry = {
      name,
      version,
      license,
      author: authorText(manifest.author),
      repository: repositoryUrl(manifest.repository) || manifest.homepage || '',
      licenseSource,
      texts
    }

    if (existing) {
      const knownTexts = new Set(existing.texts.map(item => item.text))
      existing.texts.push(...texts.filter(item => !knownTexts.has(item.text)))
    } else entries.set(id, entry)
  }

  return [...entries.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
}

/** Render a deterministic inventory, preserving every license file found. */
export function renderDependencyNotices(entries) {
  const sections = [
    'Jarvis Desktop — Third-Party Dependency Notices',
    'Generated from the desktop production, optional and installed peer dependency closure in package-lock.json.',
    'Packages without full license text are listed with their declared license and upstream location for follow-up.',
    ''
  ]

  for (const entry of entries) {
    sections.push(`## ${entry.name}@${entry.version}`, `License: ${entry.license}`)
    if (entry.author) sections.push(`Author: ${entry.author}`)
    if (entry.repository) sections.push(`Upstream: ${entry.repository}`)
    if (entry.licenseSource) sections.push(`License source: ${entry.licenseSource}`)

    if (!entry.texts.length) {
      sections.push('A full license text was not found in the installed npm package; consult the upstream location above for its terms.', '')
      continue
    }

    for (const file of entry.texts) sections.push(`### ${file.file}`, '', file.text, '')
    sections.push('')
  }

  return `${sections.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`
}

export function generateThirdPartyNotices(root, output) {
  const entries = collectDependencyNotices(root)
  const text = renderDependencyNotices(entries)
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, text, 'utf8')
  return { entries: entries.length, missingTexts: entries.filter(entry => !entry.texts.length).length, output }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(import.meta.dirname, '../../..')
  const output = path.join(root, 'apps/desktop/build/licenses/THIRD_PARTY_NOTICES.txt')
  const result = generateThirdPartyNotices(root, output)
  console.log(`[third-party-notices] wrote ${result.entries} dependency entries (${result.missingTexts} without packaged license text) to ${result.output}`)
}
