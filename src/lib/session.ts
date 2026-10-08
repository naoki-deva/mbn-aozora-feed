import { AtpAgent, type AtpSessionData } from '@atproto/api'
export const PUBLIC_SERVICE = 'https://public.api.bsky.app'
export const DEFAULT_PDS = 'https://bsky.social'
const KEY = 'aozora:sessions:v1'
const ACTIVE = 'aozora:active-account'
export type StoredAccount = { service: string; session: AtpSessionData; remember: boolean }
export function validateService(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new Error('PDSはHTTPSのURLで指定してください。')
  return url.origin
}
function validAccount(a: unknown): a is StoredAccount {
  if (!a || typeof a !== 'object') return false
  const value = a as StoredAccount
  try {
    validateService(value.service)
  } catch {
    return false
  }
  return (
    typeof value.remember === 'boolean' &&
    typeof value.service === 'string' &&
    value.service.startsWith('https://') &&
    typeof value.session?.did === 'string' &&
    typeof value.session?.handle === 'string' &&
    typeof value.session?.accessJwt === 'string' &&
    typeof value.session?.refreshJwt === 'string'
  )
}
function read(storage: Storage): StoredAccount[] {
  try {
    const data: unknown = JSON.parse(storage.getItem(KEY) || '[]')
    return Array.isArray(data) ? data.filter(validAccount) : []
  } catch {
    return []
  }
}
export function savedAccounts(): StoredAccount[] {
  const accounts = [...read(sessionStorage), ...read(localStorage)]
  return accounts.filter((a, i) => accounts.findIndex((b) => a.session.did === b.session.did) === i)
}
export function saveAccount(account: StoredAccount) {
  const target = account.remember ? localStorage : sessionStorage
  const other = account.remember ? sessionStorage : localStorage
  target.setItem(
    KEY,
    JSON.stringify([...read(target).filter((a) => a.session.did !== account.session.did), account]),
  )
  other.setItem(
    KEY,
    JSON.stringify(read(other).filter((a) => a.session.did !== account.session.did)),
  )
  sessionStorage.setItem(ACTIVE, account.session.did)
  if (account.remember) localStorage.setItem(ACTIVE, account.session.did)
  else localStorage.removeItem(ACTIVE)
}
export function forgetAccount(did: string) {
  for (const storage of [sessionStorage, localStorage]) {
    storage.setItem(KEY, JSON.stringify(read(storage).filter((a) => a.session.did !== did)))
    if (storage.getItem(ACTIVE) === did) storage.removeItem(ACTIVE)
  }
}
export function activeAccount(): StoredAccount | undefined {
  const active = sessionStorage.getItem(ACTIVE) ?? localStorage.getItem(ACTIVE)
  return savedAccounts().find((a) => a.session.did === active)
}
const timeoutFetch: typeof fetch = (input, init) =>
  fetch(input, {
    ...init,
    signal: init?.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(30_000)])
      : AbortSignal.timeout(30_000),
  })
export function makeAgent(service: string, remember: boolean, identity?: string) {
  let live = true
  let lastDid = identity
  const agent = new AtpAgent({
    service: validateService(service),
    fetch: timeoutFetch,
    persistSession: (event, session) => {
      if (!live) return
      if ((event === 'create' || event === 'update') && session) {
        lastDid = session.did
        saveAccount({ service: validateService(service), session, remember })
      }
      if (event === 'expired') {
        const did = session?.did ?? agent.session?.did ?? lastDid
        if (did) {
          forgetAccount(did)
          window.dispatchEvent(new CustomEvent('aozora:session-expired', { detail: did }))
        }
      }
    },
  })
  return {
    agent,
    dispose: () => {
      live = false
    },
  }
}
export const publicAgent = new AtpAgent({ service: PUBLIC_SERVICE, fetch: timeoutFetch })
