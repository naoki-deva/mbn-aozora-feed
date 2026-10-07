import { readAccountPreferences, type RemotePreferences } from './remote-preferences'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useQuery } from '@tanstack/react-query'
import { DEFAULT_LABEL_SETTINGS, type AtpAgent, type ModerationOpts } from '@atproto/api'
import { activeAccount, makeAgent, publicAgent, forgetAccount, savedAccounts } from './session'
import {
  defaults,
  startupPreferences,
  readPreferences,
  writePreferences,
  normalizePreferences,
  errorMessage,
  type FeedSource,
  type Preferences,
} from './preferences'
import { queryClient } from './query'
import type { Post } from './api'
type ComposerTarget = { reply?: Post; quote?: Post }
type Toast = { id: number; message: string; error: boolean }
type AppContextValue = {
  agent: AtpAgent
  did?: string
  handle?: string
  restoring: boolean
  sessionError?: string
  prefs: Preferences
  updatePrefs: (patch: Partial<Preferences>) => void
  addFeed: (feed: FeedSource) => void
  loginOpen: boolean
  openLogin: () => void
  closeLogin: () => void
  login: (identifier: string, password: string, service: string, remember: boolean) => Promise<void>
  logout: () => Promise<void>
  switchAccount: (did: string) => Promise<void>
  requireAuth: () => boolean
  composer: ComposerTarget | null
  compose: (target?: ComposerTarget) => void
  closeComposer: () => void
  toast: (message: string, error?: boolean) => void
  toasts: Toast[]
  dismissToast: (id: number) => void
}
const AppContext = createContext<AppContextValue | undefined>(undefined)
export function AppProvider({ children }: { children: ReactNode }) {
  const [agent, setAgent] = useState(publicAgent)
  const [restoring, setRestoring] = useState(true)
  const [sessionError, setSessionError] = useState<string>()
  const [prefs, setPrefs] = useState(() => startupPreferences())
  const [loginOpen, setLoginOpen] = useState(false)
  const [composer, setComposer] = useState<ComposerTarget | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const activeDispose = useRef<(() => void) | undefined>(undefined)
  const epoch = useRef(0)
  const init = useRef<
    | Promise<
        | { agent: AtpAgent; dispose: () => void; preferences: RemotePreferences }
        | { error: string }
        | undefined
      >
    | undefined
  >(undefined)
  const toast = useCallback(
    (message: string, error = false) =>
      setToasts((t) => [...t.slice(-3), { id: Date.now() + Math.random(), message, error }]),
    [],
  )
  const dismissToast = useCallback(
    (id: number) => setToasts((t) => t.filter((x) => x.id !== id)),
    [],
  )
  useEffect(() => {
    let live = true
    init.current ??= (async () => {
      const account = activeAccount()
      if (!account) return
      const next = makeAgent(account.service, account.remember, account.session.did)
      try {
        await next.agent.resumeSession(account.session)
        const preferences = await readAccountPreferences(next.agent)
        return { ...next, preferences }
      } catch (error) {
        next.dispose()
        return { error: errorMessage(error) }
      }
    })()
    void init.current.then((next) => {
      if (!live) return
      if (next && 'error' in next) setSessionError(next.error)
      else if (next) {
        activeDispose.current = next.dispose
        queryClient.setQueryData([next.agent.session!.did, 'preferences'], next.preferences)
        setAgent(next.agent)
        setPrefs(startupPreferences(next.agent.session!.did))
      }
      setRestoring(false)
    })
    return () => {
      live = false
    }
  }, [])
  const activate = async (next: { agent: AtpAgent; dispose: () => void }) => {
    const preferences = await readAccountPreferences(next.agent)
    activeDispose.current?.()
    await queryClient.cancelQueries()
    queryClient.clear()
    queryClient.setQueryData([next.agent.session!.did, 'preferences'], preferences)
    activeDispose.current = next.dispose
    setComposer(null)
    setAgent(next.agent)
    const own = startupPreferences(next.agent.session!.did)
    // A guest's explicit choices are retained on the first login; no feeds are injected.
    const chosen = !own.onboarded ? readPreferences() : own
    setPrefs(chosen)
    try {
      writePreferences(next.agent.session!.did, chosen)
    } catch {
      toast('設定をブラウザに保存できませんでした。', true)
    }
    setSessionError(undefined)
    setLoginOpen(false)
  }
  const login = async (
    identifier: string,
    password: string,
    service: string,
    remember: boolean,
  ) => {
    const token = ++epoch.current
    const next = makeAgent(service, remember)
    try {
      await next.agent.login({ identifier: identifier.trim().replace(/^@/, ''), password })
      if (token !== epoch.current) {
        next.dispose()
        return
      }
      await activate(next)
      toast('ログインしました')
    } catch (error) {
      next.dispose()
      throw error
    }
  }
  const logout = async () => {
    ++epoch.current
    const old = agent
    activeDispose.current?.()
    if (old.session) forgetAccount(old.session.did)
    await queryClient.cancelQueries()
    queryClient.clear()
    setAgent(publicAgent)
    setPrefs(readPreferences())
    setComposer(null)
    try {
      await old.logout()
    } catch {
      toast('端末からログアウトしました。サーバーへの接続はできませんでした。', true)
    }
  }
  const switchAccount = async (did: string) => {
    const token = ++epoch.current
    const account = savedAccounts().find((a) => a.session.did === did)
    if (!account) throw new Error('保存済みのアカウントがありません。')
    const next = makeAgent(account.service, account.remember, account.session.did)
    try {
      await next.agent.resumeSession(account.session)
      if (token === epoch.current) await activate(next)
      else next.dispose()
    } catch (error) {
      next.dispose()
      throw error
    }
  }
  useEffect(() => {
    const expired = (event: Event) => {
      if ((event as CustomEvent).detail !== agent.session?.did) return
      activeDispose.current?.()
      queryClient.clear()
      setAgent(publicAgent)
      setPrefs(readPreferences())
      setComposer(null)
      setSessionError('セッションが失効しました。もう一度ログインしてください。')
    }
    window.addEventListener('aozora:session-expired', expired)
    return () => window.removeEventListener('aozora:session-expired', expired)
  }, [agent])
  const updatePrefs = (patch: Partial<Preferences>) => {
    setPrefs((current) => {
      const next = normalizePreferences({ ...current, ...patch })
      try {
        writePreferences(agent.session?.did ?? 'guest', next)
      } catch {
        /* Preferences remain usable for this tab. */
      }
      return next
    })
  }
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      document.documentElement.dataset.theme =
        prefs.theme === 'system' ? (media.matches ? 'dark' : 'light') : prefs.theme
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [prefs.theme])
  const requireAuth = () => {
    if (!agent.session) {
      setLoginOpen(true)
      return false
    }
    return true
  }
  const addFeed = (feed: FeedSource) => {
    if (prefs.feeds.some((f) => f.id === feed.id)) return
    updatePrefs({ feeds: [...prefs.feeds, feed], selectedFeed: prefs.selectedFeed ?? feed.id })
    toast(`${feed.name}をホームに追加しました`)
  }
  return (
    <AppContext.Provider
      value={{
        agent,
        did: agent.session?.did,
        handle: agent.session?.handle,
        restoring,
        sessionError,
        prefs,
        updatePrefs,
        addFeed,
        loginOpen,
        openLogin: () => setLoginOpen(true),
        closeLogin: () => setLoginOpen(false),
        login,
        logout,
        switchAccount,
        requireAuth,
        composer,
        compose: (target = {}) => {
          if (requireAuth()) setComposer(target)
        },
        closeComposer: () => setComposer(null),
        toast,
        toasts,
        dismissToast,
      }}
    >
      {children}
    </AppContext.Provider>
  )
}
// eslint-disable-next-line react-refresh/only-export-components
export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('AppProviderが必要です')
  return ctx
}
// eslint-disable-next-line react-refresh/only-export-components
export function useRemotePreferences() {
  const { agent, did } = useApp()
  return useQuery<RemotePreferences>({
    queryKey: [did, 'preferences'],
    enabled: !!did,
    queryFn: () => readAccountPreferences(agent),
    staleTime: 60_000,
  })
}
// eslint-disable-next-line react-refresh/only-export-components
export function useModeration(): { opts: ModerationOpts; ready: boolean; error: unknown } {
  const { agent, did } = useApp()
  const prefs = useRemotePreferences()
  const labels = useQuery({
    queryKey: [did, 'labelDefinitions', prefs.data?.moderationPrefs.labelers],
    enabled: !!prefs.data,
    queryFn: () => agent.getLabelDefinitions(prefs.data!.moderationPrefs),
    staleTime: 5 * 60_000,
  })
  return {
    opts: {
      userDid: did,
      prefs: prefs.data?.moderationPrefs ?? {
        adultContentEnabled: false,
        labels: { ...DEFAULT_LABEL_SETTINGS },
        labelers: agent.appLabelers.map((did) => ({ did, labels: {} })),
        mutedWords: [],
        hiddenPosts: [],
      },
      labelDefs: labels.data,
    },
    ready: !did || (prefs.isSuccess && labels.isSuccess),
    error: prefs.error ?? labels.error,
  }
}
// eslint-disable-next-line react-refresh/only-export-components
export const emptyPreferences = defaults
