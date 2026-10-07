import { useInfiniteQuery } from '@tanstack/react-query'
import { AppBskyFeedDefs } from '@atproto/api'
import { Bookmark } from 'lucide-react'
import { useApp } from '../lib/context'
import { PostCard } from '../components/PostCard'
import { Empty, ErrorState, LoadMore, PageHeader, Spinner } from '../components/ui'
export function Bookmarks() {
  const { agent, did, openLogin } = useApp()
  const posts = useInfiniteQuery({
    queryKey: [did, 'bookmarks'],
    enabled: !!did,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      (await agent.app.bsky.bookmark.getBookmarks({ limit: 30, cursor: pageParam }, { signal }))
        .data,
    getNextPageParam: (page) => page.cursor,
  })
  return (
    <>
      <PageHeader title="保存した投稿" eyebrow="KEEP A LITTLE INSPIRATION" />
      {!did ? (
        <Empty icon={<Bookmark size={37} />} title="また読みたい言葉を、ここに。">
          <p>ログインして投稿を保存できます。</p>
          <button className="button" onClick={openLogin}>
            ログイン
          </button>
        </Empty>
      ) : posts.isPending ? (
        <Spinner />
      ) : posts.isError && !posts.data ? (
        <ErrorState error={posts.error} retry={() => void posts.refetch()} />
      ) : (
        <>
          {posts.data?.pages
            .flatMap((p) => p.bookmarks)
            .map((bookmark, i) =>
              AppBskyFeedDefs.isPostView(bookmark.item) ? (
                <PostCard key={bookmark.item.uri} post={bookmark.item} />
              ) : (
                <div className="post-warning" key={i}>
                  削除済み、または表示できない投稿です。
                </div>
              ),
            )}
          {!posts.data?.pages[0].bookmarks.length && <Empty title="まだ保存した投稿はありません" />}
          <LoadMore
            hasMore={posts.hasNextPage}
            loading={posts.isFetchingNextPage}
            load={() => void posts.fetchNextPage()}
          />
          {posts.isFetchNextPageError && (
            <ErrorState error={posts.error} retry={() => void posts.fetchNextPage()} />
          )}
        </>
      )}
    </>
  )
}
