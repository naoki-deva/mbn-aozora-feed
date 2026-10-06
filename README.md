# あおぞら — 日本のいま

日本語の投稿と日本に関する話題を中心に、直近24時間の話題の投稿と、まだ注目されていない投稿者の新着を混ぜて届ける **Bluesky / AT Protocol カスタムフィード**です。Jetstreamから投稿・いいね・リポスト・返信を収集し、Blueskyクライアントが購読する `getFeedSkeleton` を返します。

## フィードの方針

- **日本語**：`langs` が `ja` / `ja-JP`、または本文に2文字以上のかながあり、日本語文字が本文の文字の15%以上を占める投稿。URL・メンションは判定対象から外します。
- **日本の話題**：日本・都道府県・主要都市名、Japan / Tokyo / Kyoto などを含む投稿。日本語以外の日本関連投稿も候補に入り、日本語投稿に追加の重みを付けます。
- **期間**：`createdAt` が現在から過去24時間以内の投稿だけを配信。新しい反応が付いた古い投稿も24時間を超えれば除外します。
- **勢い**：直近24時間のいいね・リポスト・返信と、過去1時間の反応を集計します。同じ投稿・同じ反応種別では1アカウントを1件として数え、自分の投稿への反応は数えません。
- **新着紹介**：標準で約30%の位置に、直近3時間・反応5件以下の投稿を挿入します。投稿者の保持中の24時間分の候補投稿への反応合計も20件以下を条件とし、紹介枠は新しい投稿から、各投稿者の1件目を2件目より先に選びます。反応ゼロの投稿も対象です。
- **多様性**：上位最大1,000件、同一投稿者は全体で最大3件。返信投稿は初期設定で表示候補から外しますが、対象投稿への直接返信は反応として数えます。
- **削除対応**：投稿・反応の削除、投稿の更新、アカウントの停止・削除を反映。削除済み投稿はページ送り中でも配信しません。
- **ラベル**：投稿の自己申告ラベル `!hide` / `porn` / `sexual` / `nudity` / `graphic-media` は候補から外します。外部ラベラーの判定やユーザーごとのブロック・ミュートはBluesky側の表示処理で適用されます。

「日本国内」は**日本語・日本の話題を目安**にしています。AT Protocolの通常の投稿には所在地情報がないため、投稿者の国内所在地や、反応したユーザーが日本在住であることは保証しません。地域名の検出には誤判定があり、かな・言語タグ・地域名のない日本語投稿や画像だけの投稿を取りこぼすこともあります。`ALLOWED_AUTHOR_DIDS` で明示的な投稿者リストに限定できます。

### ランキング

```text
E = いいね数 + 2.5 × リポスト数 + 1.5 × 直接返信数
R = 過去1時間のいいね数 + 2.5 × リポスト数 + 1.5 × 直接返信数

score = (1 + log(1 + E) + 1.5 × log(1 + R))
        / (投稿経過時間[h] + 2)^1.15
        × 日本語係数[1.2 / 1.0]
        × 日本関連係数[1.1 / 1.0]
```

標準では10件中3件の位置（4・7・10件目）を新着紹介枠とし、残りを上記のランキングで選びます。紹介枠の反応件数は、いいね・リポスト・直接返信それぞれのユニークアカウント数の単純合計です。まだ注目されていない投稿者かどうかは、このサービスが保持する候補投稿への反応を目安にし、フォロワー数は取得しません。ランキング枠で選ばれた新着は重複して配信せず、どちらかの枠で候補が不足すればもう一方で補います。そのため実際の新着割合は30%と一致しない場合があります。

引用投稿数やBluesky全体の累計表示数は使用しません。順番は最大60秒キャッシュし、ページ送りの順番は最初のリクエスト時のスナップショットに固定します。カーソルは署名付きで、初期設定では15分後に失効します。

## ローカル起動

Python 3.12以上と[uv](https://docs.astral.sh/uv/)が必要です。

```bash
uv sync --frozen --extra dev
cp .env.example .env
# .env の FEED_HOSTNAME / FEED_PUBLISHER_DID を設定
uv run aozora-feed
```

公開設定なしで試す場合は `.env` を作らず起動できます。APIの例：

```bash
curl http://localhost:8000/xrpc/app.bsky.feed.describeFeedGenerator
curl -G http://localhost:8000/xrpc/app.bsky.feed.getFeedSkeleton \
  --data-urlencode 'feed=at://did:web:localhost/app.bsky.feed.generator/aozora-jp' \
  --data-urlencode 'limit=50'
curl http://localhost:8000/healthz
```

公開設定をした場合は `feed` を `at://<FEED_PUBLISHER_DID>/app.bsky.feed.generator/<FEED_RKEY>` に変更してください。次ページは応答の `cursor` を同じAPIへ渡します。カーソル失効時は `cursor` なしで取得し直します。

最初の起動では24時間前のJetstreamカーソルからリプレイを要求します。**公開Jetstreamの保持期間と稼働状況によって、初回の24時間分をすべて復元できるとは限りません。** 古いデータの読み込み中は暫定的なランキングになります。`/healthz` が200になると現在のストリームへの追従を確認できますが、24時間全体の網羅性を保証するものではありません。継続運転して観測を蓄積してください。

ネットワークに接続しないAPI確認には `STREAM_ENABLED=false` を使用できます。この場合、実投稿は取り込みません。

## Blueskyで購読できるように公開する

Cloudflareの無料プランを利用する場合は、下の「Cloudflareの無料プランで公開する」を参照してください。

1. 常時稼働するサーバーに配置し、`uv sync --frozen --no-dev` を実行します。収集とAPIは**1プロセス・1ワーカー**で稼働させ、永続ストレージに `data/` を保持してください。`uvicorn --workers` や自動リロードは使用しないでください。
2. `.env` の `FEED_HOSTNAME` を実際の公開ホスト名、`FEED_PUBLISHER_DID` をフィード所有者のDIDに設定します。DIDはハンドルと異なります。BlueskyプロフィールのDID、または `com.atproto.identity.resolveHandle` で確認できます。
3. HTTPSを設定し、外部から `/.well-known/did.json` と `/xrpc/*` にアクセスできるようにします。[Caddy設定例](deploy/Caddyfile)と[systemd設定例](deploy/aozora-feed.service)を用意しています。systemdを使用する場合は専用ユーザーと書き込み可能な `data/` を事前に作成し、実際の配置先に合わせて設定を変更します。8000番ポートは外部に直接公開せず、リバースプロキシ経由で接続します。
4. 所有者の `BSKY_IDENTIFIER` と **Blueskyのアプリパスワード**を `.env` に設定します。独自PDSの場合は `BSKY_SERVICE` をそのPDSのHTTPS URLに設定してください。通常のログインパスワードは使わず、`.env` をGitに追加しないでください。
5. 登録内容を確認して登録します。

```bash
# 読み取りのみ。登録予定のレコードを表示。
uv run aozora-publish
# 公開DID・API・稼働状態とアカウントDIDを検証して登録。
uv run aozora-publish --apply
```

`--apply` は所有者の `app.bsky.feed.generator/aozora-jp` を作成、または同じキーの既存レコードを更新します。成功時に表示される `https://bsky.app/profile/<DID>/feed/aozora-jp` を開いてフィードを保存できます。登録に必要なホスト名・DID・認証情報はこのリポジトリに含めていません。

## Cloudflareの無料プランで公開する

### 現在の実装で使える構成

**現行コードをそのまま公開するなら、Cloudflare Tunnelと、常時稼働するPC・サーバーを組み合わせます。Cloudflareだけで収集・API・DBまで無料ホスティングできる実装ではありません。**

```text
Bluesky → HTTPS公開ドメイン → Cloudflare Tunnel → cloudflared → Python API
                                                               ├─ SQLite（永続ディスク）
                                                               └─ Jetstreamの常時収集
```

| 方法 | 現行コードの対応 | 別途必要なもの |
| --- | --- | --- |
| Cloudflare Free + Tunnel | そのまま利用可能 | 常時稼働するPC・サーバー、固定ドメイン |
| Workers Free / Pages Functions | そのままの配置には未対応 | API・DB・収集方式の改修 |
| Quick Tunnel | 一時的な接続確認用 | 起動中のPC・サーバー。本番登録には使わない |

Cloudflare Tunnelは無料プランでも利用できますが、Pythonの実行環境やディスクを提供するサービスではありません。ドメインの取得・更新、サーバー、電気代・通信料は別です。既存の常時稼働マシンと所有ドメインがあれば、Cloudflare側の有料機能を使わずに公開できます。[Tunnelの公式案内](https://developers.cloudflare.com/tunnel/)

以下はLinux上でAPIと `cloudflared` を同じマシンに配置する例です。

### 1. ドメインと実行マシンを準備する

1. Cloudflareにドメインを追加し、Freeプランを選択します。ドメイン管理元でネームサーバーをCloudflare指定のものへ変更し、ゾーンが有効になるまで待ちます。
2. 公開ホスト名を決めます。例として、所有ドメインが `yourdomain.tld` なら `feeds.yourdomain.tld` を使用します。以降の例は自分のドメイン・DIDに置き換えてください。
3. Python 3.12以上・uvを入れた常時稼働マシンにリポジトリを配置します。スリープを無効にし、SQLiteを保存する永続ディスクと外向き通信を確保します。JetstreamにはHTTPS/WSS、Tunnelには外向きTCP/UDP 7844の接続が必要です。ルーターのポート転送や公開IPは不要です。

多段のサブドメインは証明書の追加設定が必要になる場合があるため、無料構成では `feeds.yourdomain.tld` のような1段のサブドメインを使用します。[Tunnel作成・接続要件](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/)

### 2. フィードサービスを起動する

リポジトリのディレクトリで実行します。

```bash
uv sync --frozen --no-dev
cp .env.example .env
mkdir -p data
chmod 600 .env
```

`.env` を編集します。`FEED_PUBLISHER_DID` には実際の所有者のDIDを設定し、既存の新着紹介設定などはそのまま利用できます。

```dotenv
FEED_HOSTNAME=feeds.yourdomain.tld
FEED_PUBLISHER_DID=did:plc:YOUR_ACTUAL_DID
FEED_RKEY=aozora-jp
DATABASE_PATH=data/feed.sqlite3
STREAM_ENABLED=true
BACKFILL_HOURS=24
```

まずは手動で、Tunnelからのみ接続できるようループバックで待ち受けます。

```bash
.venv/bin/uvicorn aozora_feed.api:create_app --factory \
  --host 127.0.0.1 --port 8000 --workers 1
```

別のターミナルで `curl http://127.0.0.1:8000/livez` が200になることを確認します。本番の自動起動には [systemd設定例](deploy/aozora-feed.service) を使用します。配置先を合わせ、専用ユーザーが `data/` に書き込めるようにしてください。Tunnel用には設定例の `ExecStart` を次の行に置き換えてから設置します。

```ini
ExecStart=/opt/aozora-feed/.venv/bin/uvicorn aozora_feed.api:create_app --factory --host 127.0.0.1 --port 8000 --workers 1
```

手動起動したAPIを停止してから、systemdで起動します。両方を同時に動かさないでください。

```bash
sudo cp deploy/aozora-feed.service /etc/systemd/system/aozora-feed.service
# コピー先の配置パス・ExecStartを上記の構成に合わせて編集
sudo systemctl daemon-reload
sudo systemctl enable --now aozora-feed
sudo systemctl status aozora-feed
```

### 3. Cloudflare Tunnelを作成する

1. Cloudflareダッシュボードの **Networking → Tunnels** からトンネルを作成し、名前を `aozora-feed` などにします。画面名が変わっている場合は [公式手順](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/) を参照してください。
2. 実行マシンのOS・アーキテクチャを選び、画面のインストール手順に従って `cloudflared` を導入します。[公式ダウンロード](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/)
3. ダッシュボードが表示する、トークン付きのサービス登録コマンドを実行します。Linuxの例は次の形です。トークンは秘密情報として扱い、README・Git・スクリーンショットに保存しないでください。

```bash
sudo cloudflared service install <DASHBOARD_GENERATED_TUNNEL_TOKEN>
sudo systemctl status cloudflared
```

4. トンネルの接続を確認し、**Routes → Add route → Published application** で公開ルートを追加します。

| 項目 | 設定例 |
| --- | --- |
| Subdomain | `feeds` |
| Domain | `yourdomain.tld` |
| Path | 空欄（ホスト全体を配信） |
| Service URL | `http://127.0.0.1:8000` |

5. ルートを保存し、トンネルが `Healthy` になることを確認します。同名の古いDNSレコードがあるとルート作成が競合するため、そのホスト名の既存設定を確認してください。

公開側のURLは `https://feeds.yourdomain.tld`、マシン内の接続先はHTTPで問題ありません。この構成ではCaddyやオリジンサーバーの公開TLS証明書は不要です。Cloudflare TunnelとPythonプロセスの両方が稼働している必要があります。

### 4. Blueskyからアクセスできる設定にする

- `/.well-known/did.json` と `/xrpc/*` は公開APIです。Cloudflare Accessのログイン、メール認証、ブラウザー用のJSチャレンジを要求しないようにします。Blueskyのサーバーはこれらの認証画面を通過できません。
- フィード応答を古い状態で返さないよう、公開ホストの `/xrpc/*`・`/healthz`・`/livez` に「Cache Everything」を設定しないでください。既存のキャッシュルールが対象になる場合は、これらのパスをキャッシュ対象から除外します。
- 外部からAPIの8000番ポートを直接開放する必要はありません。Tunnelへの通信だけを通し、SQLiteと `.env` はPythonの公開ルートに置きません。

### 5. 外部から確認してBlueskyへ登録する

```bash
curl -fsS https://feeds.yourdomain.tld/.well-known/did.json
curl -fsS https://feeds.yourdomain.tld/xrpc/app.bsky.feed.describeFeedGenerator
curl -fsS -G https://feeds.yourdomain.tld/xrpc/app.bsky.feed.getFeedSkeleton \
  --data-urlencode 'feed=at://did:plc:YOUR_ACTUAL_DID/app.bsky.feed.generator/aozora-jp' \
  --data-urlencode 'limit=10'
curl -i https://feeds.yourdomain.tld/healthz
```

DIDドキュメントの `id` が `did:web:feeds.yourdomain.tld`、`serviceEndpoint` が公開HTTPS URLになっていることを確認します。`/healthz` は初回リプレイ中に503を返します。現在のストリームに追従して200になるまで待ってから登録してください。

所有者の `BSKY_IDENTIFIER`・`BSKY_APP_PASSWORD`（アプリパスワード）をローカルの `.env` に設定し、リポジトリのディレクトリで実行します。

```bash
uv run aozora-publish
uv run aozora-publish --apply
```

表示されたBlueskyのフィードURLを開いて保存します。ドメインを変更するとサービスDIDも変わるため、`FEED_HOSTNAME` の変更・APIの再起動に加えて、同じレコードキーで登録を更新してください。

### 運用時の確認

```bash
sudo journalctl -u aozora-feed -n 100 --no-pager
sudo journalctl -u cloudflared -n 100 --no-pager
```

| 症状 | 確認すること |
| --- | --- |
| Cloudflareの1033エラー | `cloudflared` の停止、Tunnelの接続状態、外向き7844の通信 |
| Cloudflareの502エラー | Python APIの停止、ルートのService URLと待受ポート |
| `/healthz` が503 | 初回リプレイ中か、Jetstreamの切断・遅延・収集タスク停止か |
| ブラウザーで見えるのにBlueskyから取得できない | Access認証やJSチャレンジ、公開DIDと登録レコードの一致 |
| 停電・再起動後に空のフィードになった | `data/` の永続性と書き込み権限、両サービスの自動起動 |

マシンのスリープ・停止中は、収集も配信も止まります。復帰後はSQLiteのカーソルから再収集します。Cloudflare Tunnelを使っても、全体のJetstreamを受信するマシン側の帯域・CPU負荷は減りません。

### Cloudflareだけで動かしたい場合

このリポジトリにはWorkers用エントリーポイント・Wrangler設定・D1用実装をまだ用意していません。PagesにGitリポジトリを接続したり、`wrangler deploy` を実行したりするだけでは動作しません。Python Workers自体はありますが、現在のUvicornサーバー・ローカルSQLite・常時バックグラウンド収集をそのまま移せるわけではありません。

Cloudflareのみの構成に移すには、APIをWorkersのリクエスト処理へ移植し、SQLiteのアクセスと永続カーソル・スナップショットをD1などへ変更したうえで、収集処理の実行方式を再設計する必要があります。全体のストリームを常時処理する要件を無料枠内で満たせるか、CPU・DB書き込み量を計測して判断します。無料枠での完結は保証しません。

2026-10-06確認時点のWorkers Freeは、1日100,000リクエスト、HTTPリクエストおよびCron実行のCPU時間10msが上限です。これはTunnelの制限ではありません。上限や料金は変更されるため、移植・運用前に [Workersの制限](https://developers.cloudflare.com/workers/platform/limits/) と [D1の料金・無料枠](https://developers.cloudflare.com/d1/platform/pricing/) を確認してください。[Python Workers](https://developers.cloudflare.com/workers/languages/python/)

アカウントやドメインなしで試せる [Quick Tunnel](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/) は開発確認用です。一時URLはプロセス停止で利用できなくなるため、固定DIDが必要な本番フィードの登録先には使用しません。

## 設定

| 環境変数 | 初期値 | 用途 |
| --- | --- | --- |
| `FEED_HOSTNAME` | `localhost` | 公開HTTPSホスト名。スキーム・パス・ポートなし |
| `FEED_PUBLISHER_DID` | `did:web:localhost` | 所有者のDID |
| `FEED_RKEY` | `aozora-jp` | フィードのレコードキー |
| `DATABASE_PATH` | `data/feed.sqlite3` | SQLite永続データの保存先 |
| `PORT` | `8000` | API待受ポート |
| `STREAM_ENABLED` | `true` | Jetstream収集の有効化 |
| `JETSTREAM_URLS` | US-West / US-Eastの公開インスタンス | カンマ区切りの接続先。切断時に切り替え |
| `BACKFILL_HOURS` | `24` | 初回リプレイ要求の範囲（0〜24） |
| `INCLUDE_JAPAN_TOPICS` | `true` | 日本語以外の日本関連投稿も含める |
| `EXCLUDE_REPLIES` | `true` | 返信を表示候補から除外 |
| `MAX_POSTS_PER_AUTHOR` | `3` | 投稿者ごとの最大掲載数 |
| `MAX_FEED_POSTS` | `1000` | ランキング全体の最大件数 |
| `DISCOVERY_PERCENT` | `30` | 新着紹介枠の割合（0〜100%。0ならランキングのみ） |
| `DISCOVERY_MAX_AGE_HOURS` | `3` | 新着紹介の対象期間（1〜24時間） |
| `DISCOVERY_MAX_INTERACTIONS` | `5` | 新着紹介の投稿ごとの反応件数上限（0以上） |
| `DISCOVERY_MAX_AUTHOR_INTERACTIONS` | `20` | 新着紹介の投稿者の候補投稿への反応合計上限（0以上） |
| `SNAPSHOT_TTL_SECONDS` | `900` | ページ送りカーソルの有効期間（60〜3600秒） |
| `ALLOWED_AUTHOR_DIDS` | 空 | 投稿者限定リスト。カンマ区切りのDID |
| `BLOCKED_AUTHOR_DIDS` | 空 | 掲載・反応集計から除外するDID |
| `CURSOR_SECRET` | 自動生成 | カーソル署名鍵。自動生成時はSQLiteに保持 |

設定変更は再起動で反映します。投稿の選別条件を変えた場合、既存データの再分類は行いません。別の `DATABASE_PATH` を指定して再収集するか、継続収集で候補の入れ替わりを待ってください。投稿者限定・除外リストは配信時にも適用します。

## 運用と検証

```bash
uv run pytest -q
uv run ruff check .
uv run ruff format --check .
```

- `/livez`：プロセスの生存確認。常に200。
- `/healthz`：ストリーム接続とカーソル遅延、保持件数。接続が切れている、120秒以上遅れている、収集タスクが停止した場合は503。起動直後のリプレイ中も503なので、再起動判定には `/livez` を使用してください。
- 切断時は複数のJetstream接続先を切り替え、最大60秒のバックオフで再接続します。SQLiteに保存したカーソルの5秒前から再取得して重複を吸収し、24時間以上停止した場合は24時間前から再開します。
- 候補のAT URI・DID・時刻・言語/話題フラグ・反応だけを保存し、投稿本文・画像・API閲覧者の認証情報は保存しません。24時間を超えた候補と反応を定期削除し、削除イベントの再取得対策に更新時刻を追加5分保持します。SQLiteファイルの容量は自動的に縮みませんが、削除領域を再利用します。
- この実装は小規模な単一サーバー向けです。候補だけを保存しますが、収集側では全体のpost/like/repostストリームを読みます。CPU・帯域・ディスクと `/healthz` の遅延を監視し、高負荷時は収集とAPIの分離や専用DBへ拡張してください。
- `HTTPS_PROXY` / `WSS_PROXY` を経由する環境に対応します。TLS証明書検証は有効です。

公式仕様：[カスタムフィード](https://docs.bsky.app/docs/starter-templates/custom-feeds) · [Jetstream](https://github.com/bluesky-social/jetstream-legacy) · [getFeedSkeleton Lexicon](https://github.com/bluesky-social/atproto/blob/main/lexicons/app/bsky/feed/getFeedSkeleton.json)
