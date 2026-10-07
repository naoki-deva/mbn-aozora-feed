import { useState } from 'react'
import { useApp } from '../lib/context'
import { Modal, useAction } from './ui'
export function Report({
  subject,
  onClose,
}: {
  subject: { did: string } | { uri: string; cid: string }
  onClose: () => void
}) {
  const { agent } = useApp()
  const [reason, setReason] = useState('com.atproto.moderation.defs#reasonSpam')
  const [text, setText] = useState('')
  const action = useAction(
    async () =>
      agent.createModerationReport({
        reasonType: reason,
        reason: text || undefined,
        subject:
          'did' in subject
            ? { $type: 'com.atproto.admin.defs#repoRef', did: subject.did }
            : { $type: 'com.atproto.repo.strongRef', ...subject },
      }),
    '報告を送信しました',
    onClose,
  )
  return (
    <Modal
      title="コンテンツを報告"
      onClose={() => {
        if (!action.isPending) onClose()
      }}
    >
      <form
        className="modal-body stack"
        onSubmit={(e) => {
          e.preventDefault()
          action.mutate()
        }}
      >
        <label>
          報告の理由
          <select value={reason} onChange={(e) => setReason(e.target.value)}>
            {[
              ['reasonSpam', 'スパム'],
              ['reasonViolation', 'ルール違反'],
              ['reasonMisleading', '誤解を招く内容'],
              ['reasonSexual', '不適切な性的内容'],
              ['reasonRude', '嫌がらせ'],
              ['reasonOther', 'その他'],
            ].map(([key, label]) => (
              <option key={key} value={`com.atproto.moderation.defs#${key}`}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          詳細（任意）
          <textarea
            value={text}
            maxLength={2000}
            onChange={(e) => setText(e.target.value)}
            rows={4}
          />
        </label>
        <button className="button" disabled={action.isPending}>
          {action.isPending ? '送信中…' : '報告を送信'}
        </button>
      </form>
    </Modal>
  )
}
