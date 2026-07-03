import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEGRADED_AFTER, HEARTBEAT_MS, HEARTBEAT_RETRY_MS } from './config'
import { createSessionController } from './session-controller'
import type { ScrobbleItem, ScrobblePayload } from './types'

// ── fakes ────────────────────────────────────────────────────────────────────

type Behavior = () => Promise<unknown>

function makeClient(
  behavior: Partial<Record<'start' | 'pause' | 'stop' | 'check', Behavior>> = {},
) {
  const calls = {
    start: [] as ScrobblePayload[],
    pause: [] as ScrobblePayload[],
    stop: [] as ScrobblePayload[],
    check: [] as unknown[],
  }
  const mk =
    (name: 'start' | 'pause' | 'stop') =>
    (payload: ScrobblePayload): Promise<unknown> => {
      calls[name].push(payload)
      return behavior[name] ? behavior[name]() : Promise.resolve({})
    }
  return {
    calls,
    start: mk('start'),
    pause: mk('pause'),
    stop: mk('stop'),
    check: () => {
      calls.check.push(1)
      return behavior.check ? behavior.check() : Promise.resolve({})
    },
  }
}

function makeSettings(
  over: Partial<{ enabled: boolean; token: string; threshold: number; notify: boolean }> = {},
) {
  return {
    token: 'tok',
    baseUrl: 'https://api',
    threshold: 80,
    enabled: true,
    notify: false,
    status: '' as string,
    setStatus(s: string) {
      this.status = s
    },
    ...over,
  }
}

const item = (over: Partial<ScrobbleItem> = {}): ScrobbleItem => ({
  card: { tmdb: 1, title: 'X' },
  season: 1,
  episode: 1,
  percent: 10,
  ...over,
})

// Drain microtasks + one macrotask so client .then handlers run.
const flush = () => new Promise<void>((r) => setTimeout(r, 0))

function setup(
  opts: {
    settings?: ReturnType<typeof makeSettings>
    client?: ReturnType<typeof makeClient>
    now?: () => number
  } = {},
) {
  const settings = opts.settings ?? makeSettings()
  const client = opts.client ?? makeClient()
  const showNoty = vi.fn()
  let clock = 0
  const now = opts.now ?? (() => clock)
  const session = createSessionController({ settings, client, now, showNoty, log: () => {} })
  return { session, settings, client, showNoty, setClock: (t: number) => (clock = t) }
}

// ── tests ────────────────────────────────────────────────────────────────────

describe('session gating', () => {
  it('does nothing when disabled or tokenless', () => {
    const disabled = setup({ settings: makeSettings({ enabled: false }) })
    disabled.session.play(item())
    expect(disabled.client.calls.start).toHaveLength(0)

    const noToken = setup({ settings: makeSettings({ token: '' }) })
    noToken.session.play(item())
    expect(noToken.client.calls.start).toHaveLength(0)
  })
})

describe('play', () => {
  it('sends /start with the built payload', () => {
    const { session, client } = setup()
    session.play(item())
    expect(client.calls.start).toHaveLength(1)
    expect(client.calls.start[0]).toMatchObject({
      source_app: 'lampa',
      episode: { season: 1, number: 1 },
    })
  })

  it('dedupes the same signature', () => {
    const { session, client } = setup()
    session.play(item())
    session.play(item())
    expect(client.calls.start).toHaveLength(1)
  })

  it('opens a new session for a different signature', () => {
    const { session, client } = setup()
    session.play(item({ episode: 1 }))
    session.play(item({ episode: 2 }))
    expect(client.calls.start).toHaveLength(2)
  })
})

describe('progress heartbeat', () => {
  it('throttles /pause to the heartbeat interval', async () => {
    const { session, client, setClock } = setup()
    session.play(item())
    await flush()

    setClock(HEARTBEAT_MS - 1)
    session.progress(item({ percent: 40 }))
    expect(client.calls.pause).toHaveLength(0) // too soon

    setClock(HEARTBEAT_MS)
    session.progress(item({ percent: 41 }))
    expect(client.calls.pause).toHaveLength(1) // interval elapsed
  })

  it('sends /stop once at the threshold and then goes quiet', async () => {
    const { session, client, setClock } = setup()
    session.play(item())
    await flush()

    setClock(HEARTBEAT_MS)
    session.progress(item({ percent: 80 }))
    session.progress(item({ percent: 95 }))
    expect(client.calls.stop).toHaveLength(1)
    expect(client.calls.pause).toHaveLength(0)
  })
})

describe('resilience', () => {
  it('shortens the interval on a transient error, then degrades after N', async () => {
    const client = makeClient({ pause: () => Promise.reject({ status: 500, message: 'boom' }) })
    const settings = makeSettings({ notify: true })
    const { session, showNoty, setClock } = setup({ client, settings })
    session.play(item())
    await flush()

    let t = HEARTBEAT_MS
    for (let i = 0; i < DEGRADED_AFTER; i++) {
      setClock(t)
      session.progress(item({ percent: 40 }))
      await flush()
      t += HEARTBEAT_MS // always past whatever the current interval is
    }

    expect(client.calls.pause).toHaveLength(DEGRADED_AFTER)
    expect(settings.status).toBe('error')
    // interval after first failure was the short retry window
    expect(HEARTBEAT_RETRY_MS).toBeLessThan(HEARTBEAT_MS)
    // degraded notification shown once
    expect(showNoty).toHaveBeenCalledWith('MyShows: проблемы со связью, отправка замедлена')
  })

  it('stops the session and marks the token invalid on 401', async () => {
    const client = makeClient({ pause: () => Promise.reject({ status: 401, message: 'nope' }) })
    const settings = makeSettings({ notify: true })
    const { session, showNoty, setClock } = setup({ client, settings })
    session.play(item())
    await flush()

    setClock(HEARTBEAT_MS)
    session.progress(item({ percent: 40 }))
    await flush()
    expect(settings.status).toBe('invalid')
    expect(showNoty).toHaveBeenCalledWith('MyShows: токен недействителен — скробблинг остановлен')

    // session is stopped: further progress sends nothing
    setClock(HEARTBEAT_MS * 3)
    session.progress(item({ percent: 50 }))
    expect(client.calls.pause).toHaveLength(1)
  })
})

describe('finish / abort', () => {
  it('sends /stop on finish when the threshold was reached', async () => {
    const { session, client } = setup()
    session.play(item())
    await flush()
    session.finish(item({ percent: 90 }))
    expect(client.calls.stop).toHaveLength(1)
  })

  it('does not send /stop on finish below the threshold', async () => {
    const { session, client } = setup()
    session.play(item())
    await flush()
    session.finish(item({ percent: 30 }))
    expect(client.calls.stop).toHaveLength(0)
  })

  it('abort drops the session silently', async () => {
    const { session, client } = setup()
    session.play(item())
    await flush()
    session.abort()
    session.finish(item({ percent: 90 }))
    expect(client.calls.stop).toHaveLength(0)
  })
})

beforeEach(() => {
  vi.restoreAllMocks()
})
