import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { spawnProcess } from '../../../shared/child-process/run-process'

export const SECOND_WINDOW_LAUNCH_RECORD_ENV = 'ORCA_FORK_WINDOW_LAUNCH_RECORD'

export type SecondWindowLaunch = {
  mode: 'packaged-mac' | 'packaged' | 'dev'
  program: string
  args: string[]
  /** Only the variables this launch sets; the rest is inherited. */
  envOverrides: Record<string, string>
  slotDir: string
}

// Same walk as the CLI's getMacAppBundlePath, which the main tsconfig cannot import.
function getMacAppBundlePath(execPath: string): string | null {
  const bundlePath = resolve(dirname(execPath), '..', '..')
  return bundlePath.endsWith('.app') ? bundlePath : null
}

export function buildSecondWindowLaunch(args: {
  slotDir: string
  isPackaged: boolean
  platform: NodeJS.Platform
  execPath: string
  appPath: string
}): SecondWindowLaunch {
  const { slotDir, isPackaged, platform, execPath, appPath } = args
  const userDataArg = `--user-data-dir=${slotDir}`
  const envOverrides: Record<string, string> = { ORCA_USER_DATA_PATH: slotDir }
  if (!isPackaged) {
    // Why: an unpackaged build takes its profile from ORCA_DEV_USER_DATA_PATH, not --user-data-dir.
    envOverrides.ORCA_DEV_USER_DATA_PATH = slotDir
    return { mode: 'dev', program: execPath, args: [appPath, userDataArg], envOverrides, slotDir }
  }
  const bundlePath = platform === 'darwin' ? getMacAppBundlePath(execPath) : null
  if (bundlePath) {
    // Why `-n`: plain `open` only activates the running main window; `--args` reach a new instance only.
    return {
      mode: 'packaged-mac',
      program: 'open',
      args: ['-n', bundlePath, '--args', userDataArg],
      envOverrides,
      slotDir
    }
  }
  return { mode: 'packaged', program: execPath, args: [userDataArg], envOverrides, slotDir }
}

export type SecondWindowLaunchOutcome = 'spawned' | 'recorded' | 'skipped-e2e'

export function startSecondWindow(
  launch: SecondWindowLaunch,
  env: NodeJS.ProcessEnv = process.env,
  onFailed: () => void = () => {}
): SecondWindowLaunchOutcome {
  const recordPath = env[SECOND_WINDOW_LAUNCH_RECORD_ENV]
  if (recordPath) {
    writeFileSync(recordPath, `${JSON.stringify(launch, null, 2)}\n`)
    return 'recorded'
  }
  // Why: an E2E hub must never start a real Orca next to the test instance.
  if (env.ORCA_E2E_USER_DATA_DIR) {
    return 'skipped-e2e'
  }
  const childEnv: NodeJS.ProcessEnv = { ...env, ...launch.envOverrides }
  delete childEnv.ELECTRON_RUN_AS_NODE
  const child = spawnProcess({
    program: launch.program,
    args: launch.args,
    env: childEnv,
    detached: true,
    stdio: 'ignore'
  })
  child.once('error', (error) => {
    console.error('[second-window] Launch failed:', error)
    onFailed()
  })
  child.unref()
  return 'spawned'
}
