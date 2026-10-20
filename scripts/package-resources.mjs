/** The binaries from Cargo that are copied into the app, with the file names Cargo gives them on `platform`. */
export function resources(platform) {
  if (!['darwin', 'linux', 'win32'].includes(platform)) {
    throw new Error(`Packaging is not supported on ${platform}`)
  }
  const suffix = platform === 'win32' ? '.exe' : ''
  return { agent: `target/debug/bravebot-rpc${suffix}`, files: `target/debug/bravebot-ui-files${suffix}` }
}
