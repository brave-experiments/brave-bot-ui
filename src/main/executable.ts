/** The file name Cargo gives a binary on this platform. Node's file checks, such as `existsSync`, do not add `.exe`. */
export function executable(name: string, platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? `${name}.exe` : name
}
