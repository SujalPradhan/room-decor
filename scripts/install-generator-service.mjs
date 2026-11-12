#!/usr/bin/env node
/** Per-user macOS service installer. Never reads or copies credential values. */
import { access, chmod, mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const execute = promisify(execFile);
export const SERVICE_LABEL = 'com.roomshift.generator';
const checkout = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const xml = value => String(value).replace(/[<>&"']/g, character => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[character]);
const shellQuote = value => `'${String(value).replaceAll("'", "'\"'\"'")}'`;

/**
 * Pure plan: paths and launch settings only, with no env-file contents.
 * @param {{home?: string, project?: string, node?: string, envFile?: string, blender?: string}} [options]
 */
export function buildServicePlan(options = {}) {
  const home = resolve(options.home ?? homedir());
  const project = resolve(options.project ?? checkout);
  const node = resolve(options.node ?? resolve(home, '.nvm/versions/node/v24.19.0/bin/node'));
  const envFile = resolve(options.envFile ?? resolve(project, '../.env'));
  const blender = resolve(options.blender ?? '/Applications/Blender.app/Contents/MacOS/Blender');
  const support = resolve(project, 'artifacts/generator-service');
  const wrapper = resolve(support, 'bin/blender');
  const logs = resolve(home, 'Library/Logs/RoomshiftGenerator');
  const plistPath = resolve(home, 'Library/LaunchAgents', SERVICE_LABEL + '.plist');
  const args = [node, `--env-file=${envFile}`, resolve(project, 'scripts/local-pipeline-worker.mjs'), '--max-jobs', '3', '--idle-seconds', '3600'];
  const path = [...new Set([dirname(wrapper), dirname(node), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'])].join(':');
  const stdout = resolve(logs, 'worker.log'), stderr = resolve(logs, 'worker-error.log');
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${SERVICE_LABEL}</string>
  <key>ProgramArguments</key><array>${args.map(argument => `<string>${xml(argument)}</string>`).join('')}</array>
  <key>WorkingDirectory</key><string>${xml(project)}</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(path)}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>ExitTimeOut</key><integer>180</integer>
  <key>ProcessType</key><string>Background</string>
  <key>Umask</key><integer>63</integer>
  <key>StandardOutPath</key><string>${xml(stdout)}</string>
  <key>StandardErrorPath</key><string>${xml(stderr)}</string>
</dict></plist>
`;
  return { label: SERVICE_LABEL, home, project, node, envFile, blender, support, wrapper, logs, plistPath, args, path, stdout, stderr, plist,
    wrapperSource: `#!/bin/sh\nexec ${shellQuote(blender)} "$@"\n` };
}
async function available(file) { try { await access(file, constants.X_OK); return true; } catch { return false; } }
async function validatePlan(plan) {
  for (const file of [plan.node, plan.blender, resolve(plan.project, '.local-3d/runtime/bin/python')]) {
    if (!isAbsolute(file) || !await available(file)) throw Error('Generator setup is incomplete: Node 24, Blender, the worker and the local inference runtime must be installed.');
  }
  try { await access(plan.args[2], constants.R_OK); } catch { throw Error('The local generator worker script is missing or unreadable.'); }
  try { if (!(await stat(plan.envFile)).isFile()) throw Error(); await access(plan.envFile, constants.R_OK); }
  catch { throw Error('The local credential file is missing or unreadable. Configure .env before installing the generator service.'); }
  let result;
  try { result = await execute(plan.node, ['-p', 'process.versions.node'], { timeout: 10_000 }); }
  catch { throw Error('The configured Node executable could not start. Check that Node 24 is installed.'); }
  if (!/^24\./.test(result.stdout.trim())) throw Error('The generator service requires an absolute Node 24 executable. Pass --node /absolute/path/to/node.');
}
async function launchctl(args) {
  try { return { ok: true, ...(await execute('/bin/launchctl', args, { timeout: 15_000 })) }; }
  catch (error) { return { ok: false, stdout: '', stderr: '', code: error.code }; }
}
function target() {
  if (process.platform !== 'darwin' || typeof process.getuid !== 'function') throw Error('The login service is available on macOS only.');
  return `gui/${process.getuid()}/${SERVICE_LABEL}`;
}
export async function serviceStatus(plan) {
  const service = await launchctl(['print', target()]);
  let installed = false;
  try { installed = (await readFile(plan.plistPath, 'utf8')).includes(`<string>${SERVICE_LABEL}</string>`); } catch {}
  // Never echo launchctl's environment dump. Return only the fields needed by the UI/launcher.
  return { label: SERVICE_LABEL, installed, loaded: service.ok,
    state: service.ok ? (service.stdout.match(/^\s*state = (.+)$/m)?.[1]?.trim() ?? 'loaded') : 'not loaded',
    ...(service.stdout.match(/^\s*pid = (\d+)$/m) ? { pid: Number(service.stdout.match(/^\s*pid = (\d+)$/m)[1]) } : {}),
    ...(service.stdout.match(/^\s*last exit code = (-?\d+)$/m) ? { lastExitCode: Number(service.stdout.match(/^\s*last exit code = (-?\d+)$/m)[1]) } : {}),
  };
}
async function privateFile(file, content) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = file + `.tmp-${process.pid}`;
  try { await writeFile(temporary, content, { mode: 0o600 }); await chmod(temporary, 0o600); await rename(temporary, file); }
  finally { await unlink(temporary).catch(() => {}); }
}
async function prepareFiles(plan) {
  await mkdir(plan.logs, { recursive: true, mode: 0o700 }); await chmod(plan.logs, 0o700);
  for (const file of [plan.stdout, plan.stderr]) {
    const handle = await open(file, 'a', 0o600); await handle.close(); await chmod(file, 0o600);
  }
  await mkdir(dirname(plan.wrapper), { recursive: true, mode: 0o700 });
  await chmod(plan.support, 0o700); await chmod(dirname(plan.wrapper), 0o700);
  await privateFile(plan.wrapper, plan.wrapperSource); await chmod(plan.wrapper, 0o700);
  await privateFile(plan.plistPath, plan.plist);
}
export async function runInstaller(argv = process.argv.slice(2)) {
  const command = argv[0] ?? 'status', options = {};
  for (let index = 1; index < argv.length; index += 2) {
    const name = argv[index], value = argv[index + 1];
    if (!['--node', '--env-file', '--output'].includes(name) || !value) throw Error('Use install, status, uninstall, or dry-run; optional --node, --env-file and --output require a path.');
    options[name] = resolve(value);
  }
  const plan = buildServicePlan({ node: options['--node'], envFile: options['--env-file'] });
  if (command === 'dry-run') {
    await validatePlan(plan);
    if (options['--output']) await privateFile(options['--output'], plan.plist);
    console.log(JSON.stringify({ label: SERVICE_LABEL, installed: false, dryRun: true, plistPath: options['--output'] ?? plan.plistPath, arguments: plan.args, workingDirectory: plan.project, logFiles: [plan.stdout, plan.stderr], throttleSeconds: 30, keepAlive: true, runAtLoad: true }, null, 2));
    return;
  }
  const serviceTarget = target();
  if (command === 'status') { console.log(JSON.stringify(await serviceStatus(plan), null, 2)); return; }
  if (command === 'uninstall') {
    const status = await serviceStatus(plan);
    if (status.loaded && !(await launchctl(['bootout', serviceTarget])).ok) throw Error('The Roomshift service could not be stopped. No other login service was changed.');
    if (status.installed) await unlink(plan.plistPath).catch(error => { if (error.code !== 'ENOENT') throw error; });
    console.log('Roomshift automatic generator removed. Local credentials, models and private logs were retained.');
    return;
  }
  if (command !== 'install') throw Error('Choose install, status, uninstall, or dry-run.');
  await validatePlan(plan);
  const existing = await serviceStatus(plan);
  if (existing.loaded) {
    const current = await readFile(plan.plistPath, 'utf8').catch(() => '');
    if (current !== plan.plist) throw Error('Roomshift is already registered with different launch settings. Uninstall its service before installing the new settings; this stops its current job.');
    console.log('Roomshift automatic generator is already registered. You can close this window.'); return;
  }
  await prepareFiles(plan);
  // Only this explicit label is enabled or bootstrapped. No global launchctl changes.
  if (!(await launchctl(['enable', serviceTarget])).ok) throw Error('Roomshift could not enable its own login service.');
  if (!(await launchctl(['bootstrap', serviceTarget.slice(0, serviceTarget.lastIndexOf('/')), plan.plistPath])).ok)
    throw Error('Roomshift could not register its login service. Run status to check it; no other service was changed.');
  console.log('Roomshift automatic generator installed for your login. You can close this window and paste product links on the site.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runInstaller().catch(error => { console.error(error.message); process.exitCode = 1; });
}
