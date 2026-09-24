# HeartLens

Decode the connection. Paste someone's dating or social profile and, optionally, your conversation with them. HeartLens reads the text and gives you:

- **The read** – a short summary and an honest note on how much there was to go on
- **Likely interests** – each one tied to the phrase it came from, with a confidence level
- **Communication style** – how they write, plus tips on matching it without imitating it
- **Engagement** – how into the conversation they seem, and what points to that
- **Opener angles** – specific, respectful first messages (or next messages), ready to copy
- **Probably avoid** – topics or moves that would land badly
- **Look out for yourself** – inconsistencies, scam patterns, or clear disinterest

Results are estimates about a real person, not facts. The prompt is written to ground every claim in the text, refuse manipulation tactics, and tell you plainly when someone isn't interested.

## Run it

Requires Node 20 or newer and an [Anthropic API key](https://console.anthropic.com/).

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...
npm start
```

Then open http://localhost:3000.

To work on the UI without spending API calls, `npm run dev` starts the server in mock mode and returns canned sample output.

### Configuration

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | – | Required for real analysis |
| `PORT` | `3000` | Port to listen on |
| `HEARTLENS_MODEL` | `claude-opus-5` | Claude model to use |
| `HEARTLENS_EFFORT` | `medium` | `low`, `medium`, `high`, `xhigh` or `max`; trades depth for speed and cost |
| `HEARTLENS_MOCK` | unset | Set to `1` to skip the API and return sample output |

See `.env.example`. Node 20+ can load it with `node --env-file=.env server.js`.

## How it works

```
public/        static front end (index.html, app.js, styles.css, privacy, terms)
server.js      tiny Node http server: serves public/ and POST /api/analyze
lib/analyze.js prompt, response schema, and the Claude call
```

`POST /api/analyze` takes `{ profile, conversation, about }` (all strings) and returns `{ ok, result, model }`. The Claude request uses structured outputs (a Zod schema via `output_config.format`) so the response is validated JSON, a cached system prompt, and Anthropic's server-side refusal fallback so a declined request is retried on an alternate model instead of failing. Inputs are capped (6k / 12k / 1.5k characters) and request bodies at 64 KB.

Nothing you submit is stored on the server. Your browser keeps a local draft of the form so a refresh doesn't lose a pasted chat.

## Before publishing

- `public/privacy.html` and `public/terms.html` are templates. Have them reviewed.
- The API key is server-side only; never ship it to the browser.
- There is no rate limiting or auth. Add both before exposing this publicly, or every visitor spends your API budget.
