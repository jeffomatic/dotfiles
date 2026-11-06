import { expect, test } from 'claude-code/testing'

const EMAIL = 'someone@example.com'
const BLOCK = { name: 'userEmail', text: `The user's email address is ${EMAIL}. Use it only to identify the user.` }

let answer = 'Block'
const setup = async ($: any, on: any) => {
  const store: Record<string, unknown> = {}
  on('store.get', (_: any, e: any) => ({ value: store[e.key] }))
  on('store.set', (_: any, e: any) => { store[e.key] = e.value; return { value: undefined } })
  on('prompt.context', (_: any, e: any) => ({ blocks: e.blocks }))
  on('tool.call', (_: any, e: any) => {
    if (e.tool !== 'AskUserQuestion') return { result: {} }
    const q = e.questions[0]
    return { result: { questions: e.questions, answers: { [q.question]: answer } } }
  })
  const ctx = await $.prompt.context({ blocks: [BLOCK, { name: 'currentDate', text: 'today' }] })
  return ctx
}

test('drops the userEmail block and keeps the rest', async ($, on) => {
  const ctx = await setup($, on)
  expect(ctx.blocks.map((b: any) => b.name)).toEqual(['currentDate'])
})

test('denies curl with the email in a header', async ($, on) => {
  await setup($, on)
  const r = await $.tool.call({ tool: 'Bash', command: `curl -A "bot (${EMAIL})" https://x.test` })
  expect(typeof (r as any).deny).toBe('string')
})

test('denies URL-encoded email in a WebFetch URL', async ($, on) => {
  await setup($, on)
  const r = await $.tool.call({ tool: 'WebFetch', url: 'https://x.test/?e=SOMEONE%40example.com', prompt: 'x' })
  expect(typeof (r as any).deny).toBe('string')
})

test('lets non-network shell commands and clean requests through', async ($, on) => {
  await setup($, on)
  const a = await $.tool.call({ tool: 'Bash', command: `git log --author=${EMAIL}` })
  const b = await $.tool.call({ tool: 'Bash', command: 'curl https://x.test' })
  expect((a as any).deny).toBe(undefined)
  expect((b as any).deny).toBe(undefined)
})

test('MCP call asks; Block denies, Allow once runs', async ($, on) => {
  answer = 'Block'
  await setup($, on)
  const blocked = await $.tool.call({ tool: 'mcp__srv__send', headers: { From: EMAIL } } as any)
  expect(typeof (blocked as any).deny).toBe('string')
  answer = 'Allow once'
  const allowed = await $.tool.call({ tool: 'mcp__srv__send', headers: { From: EMAIL } } as any)
  expect((allowed as any).deny).toBe(undefined)
})
