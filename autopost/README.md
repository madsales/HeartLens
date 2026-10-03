# HeartLens Auto-Poster

One click posts to every connected platform. A built-in scheduler keeps posting
without you. Zero runtime dependencies — nothing to `npm install`.

```
./install.sh            # 30 seconds, no downloads
./autopost.sh connect x # log in through the browser -- no API keys to paste
./autopost.sh serve     # dashboard + scheduler on http://127.0.0.1:4310
```

---

## Read this first: what "every app" really means

You cannot post to every social platform from one button, and any tool that
claims otherwise is glossing over how these APIs work. Platforms fall into four
tiers, and this package handles all four — but differently.

| Tier | What it means | Platforms |
|---|---|---|
| **Direct API** | Works as soon as you paste credentials in. | X (Twitter), Bluesky, Mastodon, Telegram, Discord, Slack, Reddit, Tumblr, YouTube |
| **Needs platform review** | The API exists and the code is written, but the platform must approve your app (or your account must be a Business account) before posts go live. | Instagram, Facebook Pages, Threads, LinkedIn, Pinterest, TikTok |
| **Relay** | Anything the above two cannot reach. You point a webhook at Zapier / Make / n8n / Buffer and *that* service does the final publish. | Webhook relay |
| **Manual** | No usable API at all, or you have not connected it yet. Each post is written to a Markdown file ready to paste. | Outbox |

Specific limitations worth knowing before you start:

- **Instagram** needs a Business or Creator account linked to a Facebook Page,
  and it will only accept a **publicly hosted image URL** — it cannot take an
  uploaded file. A local path will not work.
- **Facebook** cannot post to a personal profile through the API at all. Pages only.
- **TikTok** keeps unaudited apps in a sandbox: uploads land in your drafts for
  manual confirmation, and only on the developer's own account.
- **YouTube** and **TikTok** are video-only. Text posts are skipped automatically
  rather than failing the run.
- **Reddit** bans accounts for repetitive self-promotion. Read the rules of any
  subreddit before pointing this at it.
- **Threads, LinkedIn, Pinterest, Tumblr** — I have flagged these adapters as
  `verified: false` because I could not test them against a live account while
  writing this, and their endpoints have changed shape before. `doctor` marks
  them "endpoint unverified". Test with `--dry-run` first and expect to check
  the linked docs if a call 4xxs.

**The outbox means a run is never wasted.** With zero credentials configured,
one click still produces a file per post, ready to paste anywhere.

---

## How this compares to Buffer and Hootsuite

Those tools are five things stacked together. This package is four of them.

| What they do | Here |
| --- | --- |
| **"Connect account" button** — OAuth login, no keys to copy | `connect <platform>`, or the Connect button in the dashboard |
| **Token vault with silent refresh** — tokens expire, they renew them | `data/tokens.json`, refreshed before every run and hourly in the daemon |
| **Posting slots** — "weekdays at 9 and 5", queue fills them | `POSTING_SLOTS=mon-fri@09:00,17:00` |
| **Fan-out worker with retries** | The publisher, with backoff and a duplicate guard |
| **Pre-approved platform partner status** | **Not possible to replicate.** See below. |

### The one thing you cannot get for free

Buffer and Hootsuite registered **once**, as companies, and passed app review
with Meta, TikTok, LinkedIn and Pinterest. That single approved app posts on
behalf of all their users. It is the reason connecting Instagram to Buffer
takes ten seconds.

Self-hosting means **you are the developer app**. The OAuth flow here is the
same one Buffer uses, but the app behind it is yours, so the gated platforms
want *your* app reviewed before they will publish from a normal account:

- **Free and instant** — X, Bluesky, Mastodon, Telegram, Discord, Slack,
  Reddit, Tumblr, YouTube. Register an app, click connect, post. Minutes.
- **Free but gated** — Instagram, Facebook, Threads, LinkedIn, Pinterest,
  TikTok. Register an app, then submit for review. No money, but a form, a
  screencast of your app, and a wait. Until it clears, these work only on your
  own developer account (or in TikTok's case, into your drafts).

That is the honest trade: you pay nothing and own your data, and in exchange
you do the app review Buffer already did. For the nine ungated platforms there
is no catch at all.

I am not confident about Buffer's or Hootsuite's current free-tier limits —
they change often — so check their pricing pages rather than taking a number
from me.

### Connecting an account

```bash
./autopost.sh connect x          # opens your browser, stores the token
./autopost.sh accounts           # who is connected, when tokens expire
./autopost.sh disconnect x       # forget it
```

Each provider needs two values in `.env` first — your app's client id and
secret, which you get by registering a developer app. `doctor` and the
dashboard both name the exact variables and link to the right page.

Register this redirect URI with every provider:

```
http://127.0.0.1:4311/callback
```

Some providers reject plain `http`, even on localhost. If yours does, register
an https URL you control that forwards to that address and set
`OAUTH_REDIRECT_URI` to match.

Tokens land in `data/tokens.json` (created `0600`, never committed, never
served over the dashboard API) and are refreshed automatically before each run
and hourly while `serve` or `daemon` is up.

### Posting slots, the Buffer way

```ini
POSTING_SLOTS=mon-fri@09:00,17:00; sat,sun@11:30
TIMEZONE=Europe/London
```

Eleven slots a week. Queue posts with `queue` or the dashboard and each one
takes the next free slot; when the queue runs dry the content pack rotates in.
`POSTING_SLOTS` overrides `SCHEDULE` when both are set, and `./autopost.sh next`
prints the upcoming slots.

Day groups: `mon`..`sun`, ranges like `mon-fri` (they may wrap, `fri-mon`), or
`everyday` / `weekdays` / `weekends`.

---

## Install

Requires **Node 20 or newer** (for the built-in `fetch`). Nothing else.

### macOS / Linux / WSL

```bash
cd autopost
./install.sh            # or ./install.sh --link for a global command
```

### Windows

```powershell
cd autopost
.\install.ps1           # or .\install.ps1 -Link
```

### Docker

```bash
cp .env.example .env    # fill this in first
docker compose up -d
```

### No install at all

```bash
node bin/heartlens-autopost.js doctor
```

---

## The 1-click path

**From the dashboard** — `./autopost.sh serve`, open <http://127.0.0.1:4310>,
press the big button. It posts your text to every ticked platform at once, or,
if you leave the box empty, the next item from the built-in content pack.

**From the terminal:**

```bash
./autopost.sh postnow                                  # next pack item, dry run
./autopost.sh postnow "Understand the vibe." --live    # your text, for real
./autopost.sh postnow --platforms x,bluesky --live     # only these two
```

Nothing is sent while `DRY_RUN=true` (the default). A dry run shows you exactly
what each platform would receive, with per-platform character counts, so you can
see a post is going to be trimmed *before* it goes out.

---

## The scheduler

```bash
./autopost.sh serve      # dashboard + scheduler together
./autopost.sh daemon     # scheduler only, no dashboard
./autopost.sh next       # when are the next runs?
```

Set the cadence in `.env`:

```ini
SCHEDULE=0 9,17 * * *      # 09:00 and 17:00 daily
TIMEZONE=Europe/London     # SCHEDULE is read in this zone, not UTC
MAX_PER_RUN=1              # queued posts per firing
MIN_GAP_MINUTES=30         # never post twice to one platform inside 30 min
RECYCLE_CONTENT=true       # queue empty? rotate through the content pack
```

Standard 5-field cron, plus `@daily`, `@hourly`, `@weekly` and friends. Each run
takes the oldest due post from the queue; when the queue is empty it rotates
through the content pack so your channels never go silent.

### Keeping it running

| Setup | File |
|---|---|
| Linux server | `deploy/heartlens-autopost.service` (systemd) |
| macOS | `deploy/com.heartlens.autopost.plist` (launchd) |
| Docker | `docker-compose.yml` |
| System cron instead of the daemon | `deploy/crontab.example` |
| No server at all | `deploy/github-actions.yml` |

---

## Queue and content

```bash
./autopost.sh queue "Shipping something new today" --at "2026-10-05T18:30"
./autopost.sh fill --at "2026-10-06T09:00" --spacing 720   # whole pack, 12h apart
./autopost.sh list
./autopost.sh pack
```

Ten HeartLens posts ship in `src/content/heartlens-pack.json`. Edit it freely.
`{{site}}` is replaced with `SITE_URL` when a post is sent, and `variants` lets
one post read differently per platform:

```json
{
  "title": "Decode the connection",
  "text": "The long version, for platforms with room.",
  "variants": {
    "x": "The 280-character version.",
    "linkedin": "The professional framing."
  },
  "tags": ["HeartLens", "dating"]
}
```

Anything over a platform's limit is split into a numbered thread (X, Bluesky,
Mastodon, Threads) or trimmed on a word boundary.

---

## Getting credentials

Every block in `.env.example` says where to get its values. The quickest three
to start with:

- **Telegram** — message `@BotFather`, `/newbot`, add the bot to your channel as
  an admin. Two values, about a minute.
- **Discord** — channel settings → Integrations → Webhooks → Copy URL. One value.
- **Bluesky** — Settings → App Passwords. Use an app password, never your real one.

X/Twitter is the fiddly one: the app needs **Read and Write** permission, and if
you change that setting you must regenerate the access token afterwards or
posting returns 403.

### Webhook relay

For anything not directly supported, set `WEBHOOK_URL` and `WEBHOOK_SECRET`. Each
post is POSTed as JSON, signed so your receiver can verify it:

```
X-HeartLens-Timestamp: 1759490000
X-HeartLens-Signature: sha256=<hmac of "{timestamp}.{body}">
```

Verify it before publishing anything:

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

function verify(rawBody, timestamp, signature, secret) {
  // Reject anything older than five minutes, so a captured call cannot be replayed.
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = `sha256=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature || '');
  return a.length === b.length && timingSafeEqual(a, b);
}
```

---

## Safety rails

These exist because an auto-poster that misfires is worse than no auto-poster.

- **`DRY_RUN=true` by default.** You have to deliberately turn it off.
- **Duplicate guard.** Identical content will not go out twice inside
  `DUPLICATE_WINDOW_HOURS` (default 72). `--force` overrides it.
- **Minimum gap.** No platform is posted to twice inside `MIN_GAP_MINUTES`.
- **Fail-open.** One platform erroring never stops the others.
- **Retries** with exponential backoff and jitter, but only for errors that are
  actually retryable — a 401 is not retried.
- **Secrets are masked** in logs and never appear in an API response.
- **`data/tokens.json` is written `0600`** and is gitignored. The dashboard
  returns account names and expiry dates from it, never a token.
- **OAuth uses PKCE and a `state` check**, compared in constant time, so a
  stray callback cannot inject someone else's authorisation code.
- **The dashboard binds to 127.0.0.1.** If you change `HOST`, set
  `DASHBOARD_TOKEN` too, or anyone who can reach the port can post as you.

---

## Commands

| Command | What it does |
|---|---|
| `setup` | Create `.env` from the template |
| `connect <platform>` | Browser login, token stored for you |
| `accounts` | Connected accounts and token expiry |
| `disconnect <platform>` | Forget an account (`--all` for every one) |
| `doctor` | Every platform, what is wired up, what is missing |
| `postnow [text]` | Post once, now — the 1-click path |
| `queue <text>` | Add to the queue (`--at` to schedule) |
| `fill` | Load the whole content pack into the queue |
| `list` | Queue plus recent history |
| `pack` | Show the content pack and the rotation position |
| `run` | Run one scheduled cycle, then exit |
| `daemon` | Keep running, post on the schedule |
| `serve` | Dashboard + scheduler |
| `next` | The next few run times |

Flags: `--platforms`, `--dry-run` / `--live`, `--force`, `--title`, `--link`,
`--media`, `--at`, `--json`, `--env`.

---

## HTTP API

The dashboard is a thin client over these. `DASHBOARD_TOKEN`, when set, is
required as `Authorization: Bearer <token>` or `?token=`.

| Route | Purpose |
|---|---|
| `GET /api/status` | Mode, schedule, platform readiness, recent history |
| `POST /api/post-now` | The 1-click send. Body: `{ text?, platforms?, dryRun?, force? }` |
| `GET /api/queue` | Queued and recent posts |
| `POST /api/queue` | Add a post |
| `POST /api/queue/delete` | Remove one, by `id` |
| `POST /api/queue/fill-from-pack` | Queue the pack, optionally spaced |
| `POST /api/run-now` | Run one scheduled cycle |
| `GET /api/platforms` | Adapter metadata and missing credentials |
| `GET /api/accounts` | Connected accounts (metadata only, never a token) |
| `POST /api/connect` | Start a connect flow; returns the provider URL to open |
| `GET /api/connect/status` | Poll whether a connect finished |
| `POST /api/disconnect` | Forget a connected account |

---

## Tests

```bash
npm test     # 131 tests, about two seconds, no network
```

Covering the cron engine and posting slots (including DST and timezone
handling), the retry and duplicate logic, the store's corruption recovery,
OAuth 1.0a signing, Bluesky's UTF-8 byte offsets, and the HTTP server end to
end — including directory traversal, token auth, and that credentials never
leak into a response.

The OAuth suite runs the whole connect flow against a mock provider: the auth
redirect, the `state` CSRF check, real PKCE verification, the code exchange,
and token refresh. The callback server is tested for state mismatch, provider
errors and HTML escaping, and the vault is checked for file permissions.

---

## Adding a platform

Create `src/platforms/yours.js`:

```js
import { defineAdapter, textFor, withLink, truncate, TIERS } from './base.js';
import { postJson } from '../http.js';

export default defineAdapter({
  id: 'yours',
  label: 'Your Platform',
  tier: TIERS.API,
  limits: { text: 500, media: 4 },
  docs: 'https://…',
  required: (c) => ({ YOURS_TOKEN: c.platforms.yours.token }),

  async publish(post, { config, timeoutMs }) {
    const res = await postJson('https://api.yours.test/posts',
      { body: truncate(withLink(textFor(post, 'yours'), post.link), 500) },
      { headers: { authorization: `Bearer ${config.platforms.yours.token}` }, timeoutMs });
    return { id: res.body.id, url: res.body.permalink };
  },
});
```

Then add it to `config.js` (`platforms.yours`), register it in
`src/platforms/index.js`, and document its variables in `.env.example`.
Retries, dry-run previews, the duplicate guard and the dashboard come free.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `doctor` shows everything missing | `.env` is not where it is expected — check the path `doctor` prints, or pass `--env` |
| X returns 403 | App lacks Write permission, or the access token predates the permission change — regenerate it |
| Instagram "needs a publicly reachable https media URL" | It cannot take file uploads; host the image first |
| LinkedIn returns 426 | Bump `LINKEDIN_VERSION` to a current `YYYYMM` from their changelog |
| Posts are not going out | `DRY_RUN` is still `true`, or everything is inside `MIN_GAP_MINUTES` |
| Scheduler fires at the wrong hour | `TIMEZONE` is not set; `SCHEDULE` is read in that zone |
| Dashboard is empty | Check `serve` is running and nothing else holds the port |
| `connect` says redirect_uri mismatch | The URI registered with the provider must match `http://127.0.0.1:4311/callback` exactly, including the port |
| `connect` hangs after login | Something else is on the callback port; change `OAUTH_CALLBACK_PORT` and re-register the URI |
| A connected platform stops posting | Run `accounts`; a token with no refresh token has to be reconnected by hand |
| Instagram/TikTok connect fine but nothing appears | App review not passed yet — until then they only publish on your own developer account |

---

MIT licensed. Part of [HeartLens](https://github.com/madsales/HeartLens).
