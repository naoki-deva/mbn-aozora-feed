import { Link } from 'react-router-dom'
import { moderateProfile, type AppBskyActorDefs } from '@atproto/api'
import { useApp, useModeration } from '../lib/context'
import { profilePath } from '../lib/preferences'
import { Avatar, useAction } from './ui'
export function ProfileCard({
  profile,
  extra,
}: {
  profile: AppBskyActorDefs.ProfileView | AppBskyActorDefs.ProfileViewBasic
  extra?: React.ReactNode
}) {
  const { agent, did, requireAuth } = useApp()
  const { opts, ready } = useModeration()
  const mod = moderateProfile(profile, opts)
  const follow = useAction(async () =>
    profile.viewer?.following
      ? agent.deleteFollow(profile.viewer.following)
      : agent.follow(profile.did),
  )
  if (!ready || mod.ui('profileList').filter || mod.ui('profileList').noOverride) return null
  return (
    <div className="profile-card">
      <Link to={profilePath(profile.did)}>
        <Avatar
          src={profile.avatar}
          name={profile.displayName || profile.handle}
          blurred={mod.ui('avatar').blur}
          size={44}
        />
      </Link>
      <div>
        <Link to={profilePath(profile.did)} className={mod.ui('displayName').blur ? 'blurred' : ''}>
          <strong>{profile.displayName || profile.handle}</strong>
        </Link>
        <span className="handle">@{profile.handle}</span>
        {'description' in profile && profile.description && !mod.ui('profileList').blur && (
          <p>{profile.description}</p>
        )}
        {profile.viewer?.followedBy && <span className="pill">フォローされています</span>}
      </div>
      {extra ??
        (did !== profile.did && (
          <button
            className={`button small ${profile.viewer?.following ? 'secondary' : ''}`}
            disabled={follow.isPending || !!profile.viewer?.blocking || !!profile.viewer?.blockedBy}
            onClick={() => {
              if (requireAuth()) follow.mutate()
            }}
          >
            {profile.viewer?.following ? 'フォロー中' : 'フォロー'}
          </button>
        ))}
    </div>
  )
}
