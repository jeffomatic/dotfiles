import type { Register, EngineInterface } from 'claude-code'

// Extra addresses to guard besides the one Claude Code knows (lowercase).
const EXTRA_EMAILS: string[] = []

const STORE_KEY = 'emails'
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi
// Shell commands that look like they reach the network.
const NETWORK_RE =
  /\b(curl|wget|httpie|xh|nc|ncat|telnet|ssh|scp|rsync|ftp|sftp|gh\s+api)\b|https?:\/\/|user-agent|--header|(^|\s)-H\s|\b(requests|urllib|httpx|aiohttp|axios|fetch)\b|openssl\s+s_client/i

let known = new Set<string>(EXTRA_EMAILS.map(x => x.toLowerCase()))

const remember = async ($: EngineInterface, found: Iterable<string>) => {
  let isNew = false
  for (const f of found) {
    const lc = f.toLowerCase()
    if (!known.has(lc)) { known.add(lc); isNew = true }
  }
  if (isNew) await $.store.set(STORE_KEY, [...known])
}

const load = async ($: EngineInterface) => {
  const saved = await $.store.get(STORE_KEY)
  if (Array.isArray(saved)) for (const s of saved) if (typeof s === 'string') known.add(s.toLowerCase())
}

// The call's arguments as one lowercase string, with %40 / @ read as @.
const flatten = (e: object): string => {
  const { tool: _t, tool_use_id: _id, ...args } = e as Record<string, unknown>
  return JSON.stringify(args).toLowerCase().replace(/%40|\\u0040|&#64;|&#x40;/g, '@')
}

const leaked = (e: object): string | undefined => {
  const text = flatten(e)
  for (const k of known) if (text.includes(k)) return k
  return undefined
}

type Verdict = 'pass' | 'deny' | 'ask'

const judge = (e: { tool: string } & object): Verdict => {
  if (!leaked(e)) return 'pass'
  if (e.tool === 'Bash' || e.tool === 'PowerShell') return NETWORK_RE.test(flatten(e)) ? 'deny' : 'pass'
  if (e.tool === 'WebFetch' || e.tool === 'WebSearch') return 'deny'
  if (e.tool.startsWith('mcp__')) return 'ask'
  return 'pass'
}

const reason = (tool: string) =>
  `no-email-leak: this ${tool} call contains the user's email address. ` +
  `Do not put the user's email in HTTP headers, User-Agent strings, URLs or request payloads; ` +
  `use a generic client name, or ask the user in chat if the email is truly needed.`

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await load($)
    return next(e)
  })

  // Part 1: drop the userEmail block from the context, but learn the address first.
  on('prompt.context', async ($, e, next) => {
    const res = await next(e)
    const block = res.blocks.find(b => b.name === 'userEmail')
    if (block) await remember($, block.text.match(EMAIL_RE) ?? [])
    return { ...res, blocks: res.blocks.filter(b => b.name !== 'userEmail') }
  })

  // Part 2: guard tool calls that would send the address out.
  on('tool.call', async ($, e, next) => {
    if (known.size === 0) await load($)
    const verdict = judge(e)
    if (verdict === 'pass') return next(e)
    if (verdict === 'deny') return { deny: reason(e.tool) }
    let answer = 'Block'
    try {
      answer = await $.ui.ask(`${e.tool} wants to send your email address. Allow this call?`, {
        header: 'Email guard',
        options: ['Block', 'Allow once'],
      })
    } catch { /* dismissed or no one to ask: block */ }
    return answer === 'Allow once' ? next(e) : { deny: reason(e.tool) }
  }).catch(($, e, next) => {
    if (next.called) return next(e)
    // The guard itself failed: block only if the email is in there, else let it run.
    try { return leaked(e) ? { deny: reason(e.tool) } : next(e) } catch { return next(e) }
  })
}
