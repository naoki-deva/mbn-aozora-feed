import { beforeEach, describe, expect, it } from 'vitest'
import {
  activeAccount,
  forgetAccount,
  saveAccount,
  savedAccounts,
  validateService,
} from './session'
const session = {
  did: 'did:plc:one',
  handle: 'one.bsky.social',
  accessJwt: 'access',
  refreshJwt: 'refresh',
  active: true,
}
beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})
describe('session storage', () => {
  it('keeps sessions in this tab unless persistence was explicitly chosen', () => {
    saveAccount({ session, service: 'https://bsky.social', remember: false })
    expect(localStorage.getItem('aozora:sessions:v1')).not.toContain('access')
    expect(sessionStorage.getItem('aozora:sessions:v1')).toContain('access')
    expect(activeAccount()?.session.did).toBe(session.did)
  })
  it('moves a session rather than leaving a second persistent copy', () => {
    saveAccount({ session, service: 'https://bsky.social', remember: true })
    saveAccount({
      session: { ...session, accessJwt: 'new-access' },
      service: 'https://bsky.social',
      remember: false,
    })
    expect(localStorage.getItem('aozora:sessions:v1')).toBe('[]')
    expect(savedAccounts()).toHaveLength(1)
    expect(savedAccounts()[0].session.accessJwt).toBe('new-access')
  })
  it('forgets only the chosen account and clears its active selection', () => {
    saveAccount({ session, service: 'https://bsky.social', remember: true })
    saveAccount({
      session: { ...session, did: 'did:plc:two' },
      service: 'https://bsky.social',
      remember: false,
    })
    forgetAccount('did:plc:two')
    expect(savedAccounts()).toHaveLength(1)
    expect(activeAccount()).toBeUndefined()
  })
  it('recovers safely from invalid serialized sessions', () => {
    localStorage.setItem('aozora:sessions:v1', 'oops')
    expect(savedAccounts()).toEqual([])
    sessionStorage.setItem('aozora:sessions:v1', '[{"session":{}}]')
    expect(savedAccounts()).toEqual([])
  })
  it('rejects plaintext PDS connections and URLs containing embedded credentials', () => {
    expect(validateService('https://pds.example.com/')).toBe('https://pds.example.com')
    expect(() => validateService('http://pds.example.com')).toThrow()
    expect(() => validateService('https://user:secret@pds.example.com')).toThrow()
    expect(() => validateService('https://pds.example.com/?token=secret')).toThrow()
  })
})

it('forgets an expired restored session even when the SDK clears it before invoking the callback', async () => {
  const { makeAgent } = await import('./session')
  const { vi } = await import('vitest')
  saveAccount({ session, service: 'https://bsky.social', remember: false })
  const runtime = makeAgent('https://bsky.social', false, session.did)
  runtime.agent.sessionManager.session = session
  const expired = vi.fn()
  window.addEventListener('aozora:session-expired', expired)
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'ExpiredToken', message: 'ExpiredToken' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  )
  try {
    await expect(runtime.agent.sessionManager.refreshSession()).rejects.toThrow()
    expect(savedAccounts()).toEqual([])
    expect(expired).toHaveBeenCalledWith(expect.objectContaining({ detail: session.did }))
  } finally {
    window.removeEventListener('aozora:session-expired', expired)
    vi.unstubAllGlobals()
    runtime.dispose()
  }
})
