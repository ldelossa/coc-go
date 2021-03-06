import path from 'path'
import fs from 'fs'
import util from 'util'
import { ExecOptions, exec, execFile, spawn } from 'child_process'
import { workspace } from 'coc.nvim'
import which from 'which'
import { configDir } from './config'

const runExec = util.promisify(exec)

const isWin = process.platform === 'win32'

////////////////////////////////////////////////////////////////////////////////

export async function installGoBin(source: string, force = false): Promise<boolean> {
  const name = goBinName(source)

  if (!force && await goBinExists(name)) {
    return true
  }

  const statusItem = workspace.createStatusBarItem(90, { progress: true })
  statusItem.text = `Installing '${name}'`
  statusItem.show()

  const success = await goRun(`get ${source}@latest`) && await goBinExists(name)

  if (success) {
    workspace.showMessage(`Installed '${name}'`)
  } else {
    workspace.showMessage(`Failed to install '${name}'`, 'error')
  }

  statusItem.hide()
  return success
}

export async function goBinPath(source: string): Promise<string> {
  const name = goBinName(source)
  return path.join(await configDir('bin'), name + (isWin ? ".exe" : ""))
}

export async function runGoTool(name: string, args: string[] = []): Promise<[number, string]> {
  const bin = await goBinPath(name)
  return new Promise((resolve): void => {
    const p = spawn(bin, args)

    let out = ""
    p.stdout.on('data', (data) => out += data)

    p.on("close", code => resolve([code, out]))
  })
}

export async function commandExists(command: string): Promise<boolean> {
  if (path.isAbsolute(command)) {
    return fileExists(command)
  }
  return new Promise((resolve): void => { which(command, (err) => resolve(err == null)) })
}

////////////////////////////////////////////////////////////////////////////////

async function goBinExists(source: string): Promise<boolean> {
  const name = goBinName(source)
  const bin = await goBinPath(name)
  return fileExists(bin)
}

async function fileExists(path: string): Promise<boolean> {
  return new Promise((resolve): void => fs.open(path, 'r', (err) => resolve(err === null)))
}

async function goRun(args: string): Promise<boolean> {
  const gopath = await configDir('tools')
  const gobin = await configDir('bin')

  const env = {
    GO111MODULE: 'on',
    GOBIN: gobin,
    GOPATH: gopath,
    GOROOT: '',
    GOTOOLDIR: '',
  }
  const cmd = isWin
    ? `go ${args}`
    : `GOBIN=${gobin} go ${args}`
  const opts: ExecOptions = {
    env: Object.assign({}, process.env, env),
    cwd: gopath,
    shell: isWin ? undefined : process.env.SHELL,
    windowsHide: true,
  }

  try {
    await runExec(cmd, opts)
  } catch (ex) {
    workspace.showMessage(ex, 'error')
    return false
  }

  return true
}

interface execError {
  code?: string
}

export async function execTool(source: string, args: string[], input?: string): Promise<string> {

  const [bin, name] = await Promise.all([
    goBinPath(source),
    goBinName(source),
  ])

  if (!await commandExists(bin)) {
    await installGoBin(source)
  }

  return new Promise((resolve, reject) => {
    const p = execFile(bin, args, { cwd: workspace.cwd }, async (err: Error, stdout: Buffer, stderr: Buffer) => {
      if (err && (err as execError).code === "ENOENT") {
        return reject(`Error: Command ${name} not found! Run "CocCommand go.install.${name}" to install it and try again.`)
      }

      if (err) {
        return reject(stderr.toString())
      }

      return resolve(stdout.toString())
    })

    if (p.pid) {
      p.stdin.end(input)
    }
  })

}


////////////////////////////////////////////////////////////////////////////////


function goBinName(source: string): string {
  return source.replace(/\/\.\.\.$/, '').split('/').pop()
}

