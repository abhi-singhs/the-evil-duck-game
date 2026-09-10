import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const script = fileURLToPath(new URL('./deploy-demo.sh', import.meta.url))
const config = fileURLToPath(new URL('./azure.env', import.meta.url))
const sha = 'a'.repeat(40)
const directories = []

function deploy(overrides = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'duck-deploy-test-'))
  directories.push(directory)
  const log = join(directory, 'calls')
  writeFileSync(log, '')
  const executable = (name, body) => writeFileSync(join(directory, name),
    `#!/usr/bin/env node\n${body}`, { mode: 0o755 })
  executable('git', `
    const args = process.argv.slice(4);
    const command = args[0];
    if (command === 'rev-parse') console.log('${sha}');
    else if (command === 'status') process.stdout.write(process.env.TEST_DIRTY || '');
    else if (command === 'symbolic-ref') console.log('demo-release');
    else if (command === 'ls-remote') {
      if (process.env.TEST_REMOTE_MISSING) process.exit(2);
      console.log((process.env.TEST_REMOTE_SHA || '${sha}') + '\\trefs/heads/demo-release');
    }
    else process.exit(91);
  `)
  executable('az', `
    require('node:fs').appendFileSync(process.env.TEST_CALLS, process.argv.slice(2).join(' ') + '\\n');
    const args = process.argv.slice(2);
    if (args[0] === 'account') console.log('test-subscription');
    else if (args[0] === 'containerapp' && args[1] === 'show') {
      if (args.includes('-o')) console.log('demo.example.test');
      else if (args[args.indexOf('--output') + 1] === 'json') console.log(JSON.stringify({ properties: {
        configuration: { activeRevisionsMode: 'Single' },
        template: { scale: { minReplicas: 1, maxReplicas: 1 }, containers: [{
          image: 'acrevilduck109048529.azurecr.io/evil-duck-demo:fixture'
        }] },
        latestRevisionName: 'demo--new', latestReadyRevisionName: 'demo--new', provisioningState: 'Succeeded'
      }}));
    } else if (args[0] === 'acr' && args[1] === 'repository') console.log('sha256:fixture');
  `)
  executable('curl', `
    const args = process.argv.slice(2);
    const url = args[args.length - 1];
    if (url.endsWith('/healthz')) console.log('ok');
    else if (url.endsWith('/version')) console.log(JSON.stringify({ revision: process.env.TEST_VERSION || '${sha}' }));
    else if (url.endsWith('/ws')) { process.stdout.write('101'); process.exit(28); }
    else if (url.includes('/audio/')) process.stdout.write(process.env.TEST_AUDIO || '206');
    else process.stdout.write('200');
  `)
  const result = spawnSync('bash', [script], {
    encoding: 'utf8',
    env: {
      PATH: `${directory}:${process.env.PATH}`,
      HOME: process.env.HOME,
      TAG: 'fixture',
      TEST_CALLS: log,
      ...overrides,
    },
    timeout: 15_000,
  })
  return { ...result, calls: readFileSync(log, 'utf8') }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true })
})

describe('the guarded demo deployment', () => {
  it('preserves supplied target overrides when loading defaults', () => {
    const result = spawnSync('bash', ['-c', 'source "$1"; printf "%s %s" "$APP" "$IMAGE"', 'test', config], {
      encoding: 'utf8', env: { APP: 'ca-evil-duck-demo', IMAGE: 'evil-duck-demo' },
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('ca-evil-duck-demo evil-duck-demo')
  })

  it.each([
    { APP: 'ca-evil-duck' }, { IMAGE: 'evil-duck' }, { DEPLOY_MODE: 'provision' },
    { RESOURCE_GROUP: 'other' }, { REGISTRY: 'other' }, { ENVIRONMENT: 'other' },
  ])('refuses an unexpected target before calling Azure: %j', (env) => {
    const result = deploy(env)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('only updates the approved demo app')
    expect(result.calls).toBe('')
  })

  it('refuses dirty or unpushed source before calling Azure', () => {
    for (const env of [
      { TEST_DIRTY: ' M src/App.tsx' },
      { TEST_REMOTE_SHA: 'b'.repeat(40) },
      { TEST_REMOTE_MISSING: '1' },
    ]) {
      const result = deploy(env)
      expect(result.status).toBe(1)
      expect(result.calls).toBe('')
    }
  })

  it('builds the pushed revision and never provisions or changes permissions', () => {
    const result = deploy()
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(result.calls).toContain('--platform linux/amd64 --build-arg SOURCE_REVISION=' + sha)
    expect(result.calls).toContain('containerapp update --name ca-evil-duck-demo')
    expect(result.calls).not.toMatch(/admin-enabled|role assignment|identity assign|extension add|group create|containerapp create/)
    expect(result.stdout).toContain('source ' + sha)
  })

  it.each([{ TEST_VERSION: 'old' }, { TEST_AUDIO: '200' }])('rejects a failed runtime check: %j', (env) => {
    const result = deploy(env)
    expect(result.status).toBe(1)
    expect(result.stdout).not.toContain('Live at')
  })
})
