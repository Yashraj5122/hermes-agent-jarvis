export function packagedExecutableName(identity, platform) {
  return platform === 'win32' ? identity.windowsExecutableName : identity.displayName
}
