import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { buildServicePlan, SERVICE_LABEL } from '../scripts/install-generator-service.mjs';

const directories: string[] = [];
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function temporary() { const dir = mkdtempSync(join(tmpdir(), 'roomshift-service-test-')); directories.push(dir); return dir; }
function plist(contents: string) {
  return JSON.parse(execFileSync('python3', ['-c', 'import plistlib,json,sys; print(json.dumps(plistlib.loads(sys.stdin.buffer.read())))'], { input: contents, encoding: 'utf8' }));
}

describe('per-user automatic generator service plan', () => {
  it('uses absolute executable and env paths, safe PATH and bounded worker restarts at login', () => {
    const dir = temporary(), project = join(dir, 'room decor & models');
    const plan = buildServicePlan({ home: dir, project, node: '/opt/Node 24/bin/node', envFile: join(dir, 'private.env') });
    const parsed = plist(plan.plist);
    expect(parsed.Label).toBe(SERVICE_LABEL);
    expect(plan.plistPath).toBe(join(dir, 'Library/LaunchAgents', SERVICE_LABEL + '.plist'));
    expect(parsed.WorkingDirectory).toBe(project);
    expect(parsed.ProgramArguments).toEqual(['/opt/Node 24/bin/node', `--env-file=${join(dir, 'private.env')}`, join(project, 'scripts/local-pipeline-worker.mjs'), '--max-jobs', '3', '--idle-seconds', '3600']);
    expect(parsed.ProgramArguments.slice(0, 3).every((arg: string) => isAbsolute(arg.replace('--env-file=', '')))).toBe(true);
    expect(parsed.KeepAlive).toBe(true); expect(parsed.RunAtLoad).toBe(true);
    expect(parsed.ThrottleInterval).toBeGreaterThanOrEqual(15);
    expect(parsed.EnvironmentVariables).toEqual({ PATH: plan.path });
    expect(plan.path.split(':').every(isAbsolute)).toBe(true);
    expect(parsed.Umask).toBe(0o077);
    expect(parsed.StandardOutPath).toBe(join(dir, 'Library/Logs/RoomshiftGenerator/worker.log'));
    expect(parsed.StandardErrorPath).toBe(join(dir, 'Library/Logs/RoomshiftGenerator/worker-error.log'));
  });

  it('contains env-file location without reading or copying credentials into the plist or wrapper', () => {
    const dir = temporary(), env = join(dir, 'private.env');
    const credential = 'test-only-sensitive-marker-must-stay-local';
    writeFileSync(env, `FOUNDRY_TOKEN=${credential}\nROOMSHIFT_WORKER_TOKEN=${credential}\n`, { mode: 0o600 });
    const before = readFileSync(env, 'utf8');
    const plan = buildServicePlan({ home: dir, envFile: env });
    expect(JSON.stringify(plan)).not.toContain(credential);
    expect(plist(plan.plist).EnvironmentVariables).not.toHaveProperty('FOUNDRY_TOKEN');
    expect(readFileSync(env, 'utf8')).toBe(before);
  });

  it('escapes paths in the plist and passes Blender arguments literally through its private wrapper', () => {
    const dir = temporary(), blender = join(dir, "Blender & 'quoted'/Blender");
    mkdirSync(dirname(blender), { recursive: true });
    writeFileSync(blender, '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o700 });
    const plan = buildServicePlan({ home: dir, project: join(dir, 'project <test>'), blender });
    expect(plist(plan.plist).WorkingDirectory).toBe(join(dir, 'project <test>'));
    const wrapper = join(dir, 'blender-wrapper');
    writeFileSync(wrapper, plan.wrapperSource); chmodSync(wrapper, 0o700);
    const argumentsToPass = ['--background', 'path with spaces', 'literal $HOME `no-command` $(no-command)'];
    expect(execFileSync(wrapper, argumentsToPass, { encoding: 'utf8' })).toBe(argumentsToPass.join('\n') + '\n');
  });
});
