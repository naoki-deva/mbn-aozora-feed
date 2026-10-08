import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useMutation } from '@tanstack/react-query'
import { AlertCircle, Check, Cloud, LoaderCircle, X, ChevronLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { errorMessage, safeUrl } from '../lib/preferences'
import { useApp } from '../lib/context'
import { queryClient } from '../lib/query'
export function Logo({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand ${small ? 'small' : ''}`}>
      <span className="brand-mark">
        <Cloud size={small ? 21 : 26} strokeWidth={2.4} />
      </span>
      <span>
        あおぞら<span className="brand-tag">YOUR SKY, YOUR WAY</span>
      </span>
    </span>
  )
}
export function Spinner() {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={22} />
      <span>読み込み中…</span>
    </div>
  )
}
export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div className="error-state" role="alert">
      <AlertCircle size={25} />
      <p>{errorMessage(error)}</p>
      {retry && (
        <button className="button secondary" onClick={retry}>
          もう一度試す
        </button>
      )}
    </div>
  )
}
export function Empty({
  icon,
  title,
  children,
}: {
  icon?: ReactNode
  title: string
  children?: ReactNode
}) {
  return (
    <div className="empty">
      {icon && <span className="empty-icon">{icon}</span>}
      <h3>{title}</h3>
      <div>{children}</div>
    </div>
  )
}
export function PageHeader({
  title,
  eyebrow,
  back,
  actions,
}: {
  title: string
  eyebrow?: string
  back?: boolean
  actions?: ReactNode
}) {
  const navigate = useNavigate()
  return (
    <header className="page-header">
      {back && (
        <button
          className="icon-button"
          aria-label="戻る"
          onClick={() => {
            if (window.history.state?.idx > 0) navigate(-1)
            else navigate('/')
          }}
        >
          <ChevronLeft />
        </button>
      )}
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
      </div>
      <div className="header-actions">{actions}</div>
    </header>
  )
}
export function LoadMore({
  hasMore,
  loading,
  load,
}: {
  hasMore: boolean
  loading: boolean
  load: () => void
}) {
  return hasMore ? (
    <div className="load-more">
      <button className="button secondary" disabled={loading} onClick={load}>
        {loading ? '読み込み中…' : 'もっと見る'}
      </button>
    </div>
  ) : null
}
export function Avatar({
  src,
  name,
  size = 42,
  blurred = false,
}: {
  src?: string
  name: string
  size?: number
  blurred?: boolean
}) {
  return (
    <span
      className={`avatar ${blurred ? 'blurred' : ''}`}
      style={{ width: size, height: size, minWidth: size }}
    >
      {safeUrl(src) ? (
        <img src={safeUrl(src)} alt="" loading="lazy" />
      ) : (
        name.slice(0, 1).toUpperCase()
      )}
    </span>
  )
}
export function Toggle({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string
  description?: string
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
}) {
  const id = useId()
  return (
    <label className="toggle-row" htmlFor={id}>
      <span>
        <strong>{label}</strong>
        {description && <small>{description}</small>}
      </span>
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
      />
      <span className="switch" aria-hidden="true" />
    </label>
  )
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string
  children: ReactNode
  onClose: () => void
  wide?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  }, [onClose])
  const id = useId()
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const oldOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const node = ref.current!
    const focusable = () =>
      [
        ...node.querySelectorAll<HTMLElement>(
          'button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]',
        ),
      ].filter((el) => !el.hidden)
    const initial = node.querySelector<HTMLElement>('[data-autofocus]') ?? focusable()[0]
    initial?.focus()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close.current()
      }
      if (event.key !== 'Tab') return
      const items = focusable()
      const first = items[0]
      const last = items.at(-1)
      if (!first) {
        event.preventDefault()
        node.focus()
        return
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', key)
    return () => {
      document.body.style.overflow = oldOverflow
      document.removeEventListener('keydown', key)
      previous?.focus()
    }
  }, [])
  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={ref}
        className={`modal ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
      >
        <header>
          <h2 id={id}>{title}</h2>
          <button className="icon-button" aria-label="閉じる" onClick={onClose}>
            <X size={21} />
          </button>
        </header>
        {children}
      </div>
    </div>,
    document.body,
  )
}
export function Confirm({
  title,
  children,
  onConfirm,
  onClose,
  pending,
  destructive = true,
}: {
  title: string
  children: ReactNode
  onConfirm: () => void
  onClose: () => void
  pending?: boolean
  destructive?: boolean
}) {
  return (
    <Modal
      title={title}
      onClose={() => {
        if (!pending) onClose()
      }}
    >
      <div className="modal-body">
        <p>{children}</p>
        <div className="form-actions">
          <button className="button secondary" onClick={onClose} disabled={pending}>
            キャンセル
          </button>
          <button
            className={`button ${destructive ? 'danger' : ''}`}
            onClick={onConfirm}
            disabled={pending}
          >
            {pending ? '処理中…' : '実行する'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
// eslint-disable-next-line react-refresh/only-export-components
export function useAction<T = void>(
  fn: (value: T) => Promise<unknown>,
  message?: string,
  onSuccess?: () => void,
) {
  const { toast, did } = useApp()
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [did] })
      if (message) toast(message)
      onSuccess?.()
    },
    onError: (error) => toast(errorMessage(error), true),
  })
}
function ToastNotification({
  toast,
  dismiss,
}: {
  toast: { id: number; message: string; error: boolean }
  dismiss: (id: number) => void
}) {
  useEffect(() => {
    if (toast.error) return
    const timer = window.setTimeout(() => dismiss(toast.id), 6000)
    return () => window.clearTimeout(timer)
  }, [toast.id, toast.error, dismiss])
  return (
    <div className={`toast ${toast.error ? 'error' : ''}`}>
      {toast.error ? <AlertCircle size={18} /> : <Check size={18} />}
      <span>{toast.message}</span>
      <button aria-label="通知を閉じる" className="icon-button" onClick={() => dismiss(toast.id)}>
        <X size={16} />
      </button>
    </div>
  )
}
export function Toasts() {
  const { toasts, dismissToast } = useApp()
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <ToastNotification key={t.id} toast={t} dismiss={dismissToast} />
      ))}
    </div>
  )
}
