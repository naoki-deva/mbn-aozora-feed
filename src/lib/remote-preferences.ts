import {
  AppBskyActorDefs,
  DEFAULT_LABEL_SETTINGS,
  type AtpAgent,
  type BskyPreferences,
} from '@atproto/api'
export type RemotePreferences = Pick<
  BskyPreferences,
  'savedFeeds' | 'moderationPrefs' | 'postInteractionSettings' | 'verificationPrefs'
>
/** SDK getPreferences() migrates missing feed preferences by adding Following.
 * Read the raw endpoint instead: opening this client must never choose a feed or
 * write to someone's account on their behalf. Unknown preferences remain on the
 * server and official SDK setters preserve them when saving individual settings.
 */
export async function readAccountPreferences(agent: AtpAgent): Promise<RemotePreferences> {
  const { data } = await agent.app.bsky.actor.getPreferences({})
  const result: RemotePreferences = {
    savedFeeds: [],
    moderationPrefs: {
      adultContentEnabled: false,
      labels: { ...DEFAULT_LABEL_SETTINGS },
      labelers: agent.appLabelers.map((did) => ({ did, labels: {} })),
      mutedWords: [],
      hiddenPosts: [],
    },
    postInteractionSettings: {},
    verificationPrefs: { hideBadges: false },
  }
  let legacy: AppBskyActorDefs.SavedFeedsPref | undefined
  let v2 = false
  const labelPrefs: AppBskyActorDefs.ContentLabelPref[] = []
  for (const pref of data.preferences) {
    switch (pref.$type) {
      case 'app.bsky.actor.defs#adultContentPref':
        if (AppBskyActorDefs.validateAdultContentPref(pref).success)
          result.moderationPrefs.adultContentEnabled = (
            pref as AppBskyActorDefs.AdultContentPref
          ).enabled
        break
      case 'app.bsky.actor.defs#contentLabelPref':
        if (AppBskyActorDefs.validateContentLabelPref(pref).success)
          labelPrefs.push(pref as AppBskyActorDefs.ContentLabelPref)
        break
      case 'app.bsky.actor.defs#savedFeedsPrefV2':
        if (AppBskyActorDefs.validateSavedFeedsPrefV2(pref).success) {
          result.savedFeeds = (pref as AppBskyActorDefs.SavedFeedsPrefV2).items
          v2 = true
        }
        break
      case 'app.bsky.actor.defs#savedFeedsPref':
        if (AppBskyActorDefs.validateSavedFeedsPref(pref).success)
          legacy = pref as AppBskyActorDefs.SavedFeedsPref
        break
      case 'app.bsky.actor.defs#labelersPref':
        if (AppBskyActorDefs.validateLabelersPref(pref).success) {
          const dids = [
            ...new Set([
              ...agent.appLabelers,
              ...(pref as AppBskyActorDefs.LabelersPref).labelers.map((l) => l.did),
            ]),
          ]
          result.moderationPrefs.labelers = dids.map((did) => ({ did, labels: {} }))
        }
        break
      case 'app.bsky.actor.defs#mutedWordsPref':
        if (AppBskyActorDefs.validateMutedWordsPref(pref).success)
          result.moderationPrefs.mutedWords = (pref as AppBskyActorDefs.MutedWordsPref).items
        break
      case 'app.bsky.actor.defs#hiddenPostsPref':
        if (AppBskyActorDefs.validateHiddenPostsPref(pref).success)
          result.moderationPrefs.hiddenPosts = (pref as AppBskyActorDefs.HiddenPostsPref).items
        break
      case 'app.bsky.actor.defs#postInteractionSettingsPref':
        if (AppBskyActorDefs.validatePostInteractionSettingsPref(pref).success)
          result.postInteractionSettings = pref as AppBskyActorDefs.PostInteractionSettingsPref
        break
      case 'app.bsky.actor.defs#verificationPrefs':
        if (AppBskyActorDefs.validateVerificationPrefs(pref).success)
          result.verificationPrefs = pref as AppBskyActorDefs.VerificationPrefs
        break
    }
  }
  if (!v2 && legacy) {
    const uris = [...new Set([...legacy.pinned, ...legacy.saved])]
    result.savedFeeds = uris
      .filter((uri) => /\/app\.bsky\.(feed\.generator|graph\.list)\//.test(uri))
      .map((uri, i) => ({
        id: `legacy-${i}`,
        type: uri.includes('/app.bsky.graph.list/') ? 'list' : 'feed',
        value: uri,
        pinned: legacy!.pinned.includes(uri),
      }))
  }
  for (const pref of labelPrefs) {
    const labels = pref.labelerDid
      ? result.moderationPrefs.labelers.find((l) => l.did === pref.labelerDid)?.labels
      : result.moderationPrefs.labels
    if (labels && ['ignore', 'show', 'warn', 'hide'].includes(pref.visibility))
      labels[pref.label] =
        pref.visibility === 'show' ? 'ignore' : (pref.visibility as 'ignore' | 'warn' | 'hide')
  }
  agent.configureLabelers(result.moderationPrefs.labelers.map((l) => l.did))
  return result
}
