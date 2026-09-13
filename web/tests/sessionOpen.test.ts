import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
  customArgv,
  effectiveSessionCwd,
  openSession,
  planSessionOpen,
  vscodeFolderUrl,
} from '@/features/session-open/sessionOpen.ts'

import { planningSpaceEntity } from '@/shared/api/platformPlanningRefs.ts'
import type { PlanningSpaceEntityRef } from '@/shared/types/reference.ts'

const resourceRef = planningSpaceEntity({
  data_scope_id: '22222222-2222-4222-8222-222222222222',
  space_key: 'QA',
}) as PlanningSpaceEntityRef

function mappedRoot(canonicalRoot: string) {
  return {
    canonical_root: canonicalRoot,
    reason: '',
    resource_ref: resourceRef,
    status: 'mapped' as const,
  }
}

const target = {
  id: 'f89d66c7-f023-4169-8d1a-2e69d4b1af68',
  client: 'claude',
  cwd: 'C:\\Users\\operator\\Desktop\\projects\\example\\example-project',
  space_root: mappedRoot('C:\\Users\\operator\\Desktop\\projects\\example\\example-project'),
}

test('a claude session opens as a VS Code folder URL built from its cwd', () => {
  const plan = planSessionOpen(target, { kind: 'vscode', command: '' })
  assert.equal(plan.mode, 'url')
  if (plan.mode === 'url') {
    assert.equal(
      plan.url,
      'vscode://file/C:/Users/operator/Desktop/projects/example/example-project',
    )
  }
  assert.equal(
    vscodeFolderUrl('/home/operator/my project/'),
    'vscode://file/home/operator/my%20project',
  )
})

test('a terminal session copies a client-correct resume command in browser mode', () => {
  const plan = planSessionOpen(target, { kind: 'terminal', command: '' })
  assert.equal(plan.mode, 'spawn')
  if (plan.mode === 'spawn') {
    assert.deepEqual(plan.argv, ['claude', '--resume', target.id])
    assert.equal(plan.cwd, target.cwd)
    assert.equal(plan.display, `claude --resume ${target.id}`)
  }
})

test('Codex App URLs are canonical but browser mode refuses to launch them', () => {
  const codexTarget = {
    ...target,
    id: '019fe338-0335-7b20-8bfc-cedaad62feda',
    client: 'codex-reporter',
    client_family: 'codex' as const,
  }
  assert.deepEqual(planSessionOpen(codexTarget, { kind: 'codex-app', command: '' }), {
    mode: 'refused',
    reason: 'desktop-required',
  })
  assert.deepEqual(
    planSessionOpen({ ...codexTarget, id: 'not-a-uuid' }, { kind: 'codex-app', command: '' }),
    {
      mode: 'refused',
      reason: 'invalid-session',
    },
  )
  assert.deepEqual(
    planSessionOpen(
      { ...codexTarget, client_family: 'claude' },
      { kind: 'codex-app', command: '' },
    ),
    {
      mode: 'refused',
      reason: 'unsupported-client',
    },
  )
})

test('a custom template substitutes placeholders and honors quoted arguments', () => {
  const argv = customArgv('wt -d "{cwd}" codex resume {session}', target)
  assert.deepEqual(argv, ['wt', '-d', target.cwd, 'codex', 'resume', target.id])
  const spaced = {
    ...target,
    cwd: 'C:\\my projects\\repo',
    space_root: mappedRoot('C:\\my projects\\repo'),
  }
  const plan = planSessionOpen(spaced, { kind: 'custom', command: 'wt -d "{cwd}"' })
  assert.equal(plan.mode, 'spawn')
  if (plan.mode === 'spawn') assert.equal(plan.display, 'wt -d "C:\\my projects\\repo"')
})

test('impossible opens are refused with their reason instead of guessing', () => {
  assert.deepEqual(
    planSessionOpen({ ...target, space_root: undefined }, { kind: 'vscode', command: '' }),
    {
      mode: 'refused',
      reason: 'space-root-unavailable',
    },
  )
  assert.deepEqual(planSessionOpen({ ...target, id: '' }, { kind: 'terminal', command: '' }), {
    mode: 'refused',
    reason: 'no-session',
  })
  assert.deepEqual(planSessionOpen(target, { kind: 'custom', command: '   ' }), {
    mode: 'refused',
    reason: 'no-command',
  })
})

test('mapped space root is the effective cwd and session_cwd remains available', () => {
  const mapped = {
    ...target,
    cwd: 'C:\\observed',
    session_cwd: 'C:\\observed',
    space_root: mappedRoot('C:\\trusted'),
  }
  assert.equal(effectiveSessionCwd(mapped), 'C:\\trusted')
  const plan = planSessionOpen(mapped, { kind: 'custom', command: 'tool {cwd} {session_cwd}' })
  assert.equal(plan.mode, 'spawn')
  if (plan.mode === 'spawn') assert.deepEqual(plan.argv, ['tool', 'C:\\trusted', 'C:\\observed'])
})

test('failed space mapping is visible and does not become an invented cwd', () => {
  const plan = planSessionOpen(
    {
      ...target,
      cwd: '',
      session_cwd: '',
      space_root: {
        canonical_root: null,
        reason: 'more than one binding',
        resource_ref: null,
        status: 'ambiguous',
      },
    },
    { kind: 'terminal', command: '' },
  )
  assert.deepEqual(plan, { mode: 'refused', reason: 'space-root-unavailable' })
})

test('desktop handoff carries only the canonical resource identity', async () => {
  let request: unknown
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      valkamaDesktop: {
        openSession: async (value: unknown) => {
          request = value
          return { mode: 'opened', ok: true }
        },
      },
    },
  })
  try {
    await openSession(target, { kind: 'terminal', command: '' })
  } finally {
    Reflect.deleteProperty(globalThis, 'window')
  }
  assert.deepEqual(request, {
    client: target.client,
    client_family: undefined,
    id: target.id,
    opener: { command: '', kind: 'terminal' },
    resource_ref: resourceRef,
    session_cwd: target.cwd,
  })
})
