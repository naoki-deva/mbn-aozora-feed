import { Component, useEffect, type ReactNode } from 'react'
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Home as HomeIcon,
  Search as SearchIcon,
  Bell,
  MessageCircle,
  Rss,
  Bookmark,
  List,
  Settings as SettingsIcon,
  UserRound,
  Plus,
  ArrowUpRight,
  Sparkles,
  SlidersHorizontal,
  CloudSun,
} from 'lucide-react'
import { useApp } from './lib/context'
import { profilePath } from './lib/preferences'
import { Home, FeedPage } from './views/Home'
import { Feeds } from './views/Feeds'
import { Search } from './views/Search'
import { Profile, Connections } from './views/Profile'
import { Thread } from './views/Thread'
import { Notifications } from './views/Notifications'
import { Messages, Conversation } from './views/Messages'
import { Lists, ListPage, StarterPackPage } from './views/Lists'
import { Settings } from './views/Settings'
import { Bookmarks } from './views/Bookmarks'
import { Avatar, Empty, Logo, Toasts } from './components/ui'
import { Login } from './components/Login'
import { Composer } from './components/Composer'
class ErrorBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false }
  static getDerivedStateFromError() {
    return { error: true }
  }
  render() {
    return this.state.error ? (
      <div className="error-state" role="alert">
        <h2>画面を表示できませんでした。</h2>
        <p>再読み込みして、もう一度お試しください。</p>
        <button className="button" onClick={() => window.location.reload()}>
          再読み込み
        </button>
      </div>
    ) : (
      this.props.children
    )
  }
}
function Sidebar() {
  const { did, handle, agent, openLogin, compose, restoring } = useApp()
  const unread = useQuery({
    queryKey: [did, 'unreadCount'],
    enabled: !!did,
    refetchInterval: 60_000,
    queryFn: async ({ signal }) =>
      (await agent.countUnreadNotifications({}, { signal })).data.count,
  })
  const links = [
    { to: '/', text: 'ホーム', icon: HomeIcon },
    { to: '/search', text: '見つける', icon: SearchIcon },
    { to: '/notifications', text: '通知', icon: Bell },
    { to: '/messages', text: 'メッセージ', icon: MessageCircle },
    { to: '/feeds', text: 'フィードを選ぶ', icon: Rss },
    { to: '/bookmarks', text: '保存した投稿', icon: Bookmark },
    { to: '/lists', text: 'リスト', icon: List },
    { to: '/settings', text: '設定', icon: SettingsIcon },
  ]
  return (
    <aside className="sidebar">
      <Link to="/" className="logo-link" aria-label="あおぞら ホーム">
        <Logo />
      </Link>
      <nav aria-label="メインナビゲーション">
        {links.map(({ to, text, icon: Icon }) => (
          <NavLink
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            to={to}
            end={to === '/'}
            key={to}
          >
            <Icon size={21} strokeWidth={1.8} />
            <span>{text}</span>
            {to === '/notifications' && !!unread.data && (
              <span className="nav-badge">{unread.data > 99 ? '99+' : unread.data}</span>
            )}
          </NavLink>
        ))}
        {did ? (
          <NavLink className="nav-item" to={profilePath(did)}>
            <UserRound size={21} strokeWidth={1.8} />
            <span>プロフィール</span>
          </NavLink>
        ) : (
          <button className="nav-item" onClick={openLogin}>
            <UserRound size={21} strokeWidth={1.8} />
            <span>プロフィール</span>
          </button>
        )}
      </nav>
      <button className="button compose-button" onClick={() => compose()} disabled={restoring}>
        <Plus size={20} />
        投稿する
      </button>
      <div className="sidebar-bottom">
        {did ? (
          <Link className="sidebar-account" to="/settings">
            <Avatar name={handle || ''} size={34} />
            <div>
              <strong>@{handle}</strong>
              <small>アカウントを管理</small>
            </div>
          </Link>
        ) : (
          <div className="guest-card">
            <span className="eyebrow">HELLO, EXPLORER</span>
            <p>
              読むだけでも、
              <br />
              つながっても。
            </p>
            <button
              className="button secondary small full"
              onClick={openLogin}
              disabled={restoring}
            >
              ログイン <ArrowUpRight size={15} />
            </button>
          </div>
        )}
        <small className="sidebar-caption">Blueskyを、自分らしく。</small>
      </div>
    </aside>
  )
}
function RightRail() {
  const { prefs, did, openLogin } = useApp()
  return (
    <aside className="right-rail">
      <div className="sky-note">
        <span className="eyebrow">A SKY THAT FEELS LIKE YOU</span>
        <CloudSun size={50} strokeWidth={1.2} />
        <h2>
          好きなものが、
          <br />
          ちゃんと見える空。
        </h2>
        <p>
          フィードはあなたが選ぶもの。
          <br />
          興味のままに、ホームを作ろう。
        </p>
        <Link to="/feeds">
          フィードを見つける <ArrowUpRight size={17} />
        </Link>
      </div>
      <div className="rail-card">
        <div className="section-heading">
          <h3>あなたの空の設定</h3>
          <SlidersHorizontal size={15} />
        </div>
        <div className="rail-setting">
          <span>ホームのフィード</span>
          <strong>{prefs.feeds.length}個</strong>
        </div>
        <div className="rail-setting">
          <span>起動時に開く</span>
          <strong>{prefs.feeds.find((f) => f.id === prefs.homeFeed)?.name ?? '自由に選ぶ'}</strong>
        </div>
        <div className="rail-setting">
          <span>カウントの表示</span>
          <strong>{prefs.hideCounts ? '非表示' : '表示'}</strong>
        </div>
        <Link className="small-link" to="/settings">
          自分らしくカスタマイズ <ArrowUpRight size={13} />
        </Link>
      </div>
      <div className="rail-tip">
        <Sparkles size={18} />
        <div>
          <strong>小さな自由から。</strong>
          <p>返信やリポストを隠したり、数字を見ないで過ごしたり。心地よい見え方を選べます。</p>
        </div>
      </div>
      {!did && (
        <button className="text-button rail-login" onClick={openLogin}>
          Blueskyアカウントでログイン <ArrowUpRight size={14} />
        </button>
      )}
      <footer className="rail-footer">
        <span>非公式Blueskyクライアント</span>
        <a href="https://github.com/naoki-deva/mbn-aozora-feed" target="_blank" rel="noreferrer">
          ソースコード
        </a>
        <span>Made for your own sky.</span>
      </footer>
    </aside>
  )
}
function MobileNav() {
  const { compose, prefs } = useApp()
  const location = useLocation()
  return (
    <>
      <nav className="mobile-nav" aria-label="モバイルナビゲーション">
        <NavLink to="/" end aria-label="ホーム">
          <HomeIcon size={22} />
        </NavLink>
        <NavLink to="/search" aria-label="見つける">
          <SearchIcon size={22} />
        </NavLink>
        <NavLink to="/feeds" aria-label="フィードを選ぶ">
          <Rss size={22} />
        </NavLink>
        <NavLink to="/notifications" aria-label="通知">
          <Bell size={22} />
        </NavLink>
        <NavLink to="/settings" aria-label="設定">
          <SettingsIcon size={22} />
        </NavLink>
      </nav>
      {(location.pathname !== '/' || prefs.onboarded) && (
        <button className="mobile-compose button" aria-label="投稿する" onClick={() => compose()}>
          <Plus size={24} />
        </button>
      )}
    </>
  )
}
export default function App() {
  const { loginOpen, composer, sessionError, openLogin } = useApp()
  const location = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [location.pathname])
  return (
    <>
      <a className="skip-link" href="#main">
        コンテンツへ移動
      </a>
      <div className="app-shell">
        <Sidebar />
        <main id="main" className="main-panel">
          <div className="mobile-header">
            <Link to="/" aria-label="ホーム">
              <Logo small />
            </Link>
            <Link className="icon-button" to="/messages" aria-label="メッセージ">
              <MessageCircle size={21} />
            </Link>
          </div>
          {sessionError && (
            <div className="session-alert" role="alert">
              <span>{sessionError}</span>
              <button className="text-button" onClick={openLogin}>
                再ログイン
              </button>
            </div>
          )}
          <ErrorBoundary key={location.pathname + location.search}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/feeds" element={<Feeds />} />
              <Route path="/feed/:uri" element={<FeedPage />} />
              <Route path="/search" element={<Search />} />
              <Route path="/notifications" element={<Notifications />} />
              <Route path="/messages" element={<Messages />} />
              <Route path="/messages/:id" element={<Conversation />} />
              <Route path="/profile/:actor" element={<Profile />} />
              <Route path="/profile/:actor/:type" element={<Connections />} />
              <Route path="/post/:uri" element={<Thread />} />
              <Route path="/lists" element={<Lists />} />
              <Route path="/list/:uri" element={<ListPage />} />
              <Route path="/starter-pack/:uri" element={<StarterPackPage />} />
              <Route path="/bookmarks" element={<Bookmarks />} />
              <Route path="/settings" element={<Settings />} />
              <Route
                path="*"
                element={
                  <Empty title="ページが見つかりません">
                    <Link className="button secondary" to="/">
                      ホームへ戻る
                    </Link>
                  </Empty>
                }
              />
            </Routes>
          </ErrorBoundary>
        </main>
        <RightRail />
      </div>
      <MobileNav />
      {loginOpen && <Login />}
      {composer && <Composer />}
      <Toasts />
    </>
  )
}
