import path from 'node:path'
import { createRequire, registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'

const sandboxProbe = `if [ $HAVE_NO_SANDBOX -eq 0 ] && ! unshare -Ur true 2>/dev/null ; then
  NO_SANDBOX=(--no-sandbox)
fi`

export function patchAppRunSandboxProbe(source) {
  if (!source.includes(sandboxProbe) || source.indexOf(sandboxProbe) !== source.lastIndexOf(sandboxProbe)) {
    throw new Error('electron-builder AppRun sandbox probe template changed; revalidate the Jarvis adapter')
  }
  return source.replace(sandboxProbe, '# Jarvis leaves sandbox enforcement to Electron and the OS security profile.')
}

if (process.platform === 'linux' && process.env.HERMES_DESKTOP_VARIANT === 'jarvis') {
  const require = createRequire(path.resolve(import.meta.dirname, '../../../package.json'))
  const appBuilderLib = require.resolve('app-builder-lib')
  const appImageUtil = pathToFileURL(path.join(path.dirname(appBuilderLib), 'targets/linux/appimage/appImageUtil.js')).href

  registerHooks({
    load(url, context, nextLoad) {
      const loaded = nextLoad(url, context)
      return url === appImageUtil
        ? { ...loaded, source: patchAppRunSandboxProbe(loaded.source.toString()) }
        : loaded
    }
  })
}
