import { useState } from 'react'
import { ArrowUpRight, LockKeyhole } from 'lucide-react'
import { useApp } from '../lib/context'
import { DEFAULT_PDS } from '../lib/session'
import { errorMessage } from '../lib/preferences'
import { Modal, Logo, Toggle } from './ui'
export function Login() {
  const { login, closeLogin } = useApp()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [service, setService] = useState(DEFAULT_PDS)
  const [remember, setRemember] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  return (
    <Modal
      title="ログイン"
      onClose={() => {
        if (!pending) closeLogin()
      }}
    >
      <form
        className="modal-body login-form"
        onSubmit={async (e) => {
          e.preventDefault()
          setPending(true)
          setError('')
          try {
            await login(identifier, password, service, remember)
            setPassword('')
          } catch (err) {
            setError(errorMessage(err))
          } finally {
            setPending(false)
          }
        }}
      >
        <Logo />
        <h3>あなたのBlueskyへ。</h3>
        <p className="muted">アカウントのフィードやつながりを、そのまま使えます。</p>
        <label>
          ハンドル
          <input
            data-autofocus
            name="handle"
            autoComplete="username"
            placeholder="you.bsky.social"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            required
            disabled={pending}
          />
        </label>
        <label>
          アプリパスワード
          <input
            name="app-password"
            type="password"
            autoComplete="off"
            placeholder="xxxx-xxxx-xxxx-xxxx"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={pending}
          />
        </label>
        <div className="notice">
          <LockKeyhole size={18} />
          <span>
            Blueskyの設定で発行したアプリパスワードを入力してください。DMを使う場合は、メッセージへのアクセスを許可して発行します。
            <a href="https://bsky.app/settings/app-passwords" target="_blank" rel="noreferrer">
              アプリパスワードを作成 <ArrowUpRight size={13} />
            </a>
          </span>
        </div>
        <details>
          <summary>カスタムPDSを使う</summary>
          <label>
            PDSのURL
            <input
              type="url"
              value={service}
              onChange={(e) => setService(e.target.value)}
              disabled={pending}
              required
            />
          </label>
        </details>
        <Toggle
          label="この端末でログインを保持"
          description="オフの場合、セッションはこのタブだけに保存されます。共有端末ではオフにしてください。"
          checked={remember}
          onChange={setRemember}
          disabled={pending}
        />
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <button className="button full" disabled={pending || !identifier.trim() || !password}>
          {pending ? '接続しています…' : 'ログイン'}
        </button>
        <a className="small-link centered" href="https://bsky.app" target="_blank" rel="noreferrer">
          アカウントを新規作成 <ArrowUpRight size={13} />
        </a>
      </form>
    </Modal>
  )
}
