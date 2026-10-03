# HeartLens

Decode the connection — understand the vibe before you text.

HeartLens analyzes profile and conversation signals to estimate likely
interests, communication style, and better opener angles. Results are
probability-based estimates, not facts.

## Repository contents

| Path | What it is |
|---|---|
| `index.html` | Landing page |
| `privacy.html` | Privacy policy (template — replace before publishing) |
| `terms.html` | Terms of service (template — replace before publishing) |
| `autopost/` | **Auto-Poster**: one-click and scheduled posting to every connected social platform |

## Auto-Poster

A self-contained package that posts HeartLens content to every platform you
connect, either on a schedule or from a single click. No runtime dependencies.

```bash
cd autopost
./install.sh            # Windows: .\install.ps1
./autopost.sh doctor    # what is wired up
./autopost.sh serve     # dashboard + scheduler on http://127.0.0.1:4310
```

Direct API support for X, Bluesky, Mastodon, Telegram, Discord, Slack, Reddit,
Tumblr and YouTube; Instagram, Facebook, Threads, LinkedIn, Pinterest and TikTok
once their app review is passed; a signed webhook relay for anything else; and a
copy-paste outbox that works with no credentials at all.

Posting is a dry run by default — see [`autopost/README.md`](autopost/README.md)
for setup, per-platform caveats and the safety rails.
