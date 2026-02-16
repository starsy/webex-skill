---
name: webex-messaging
description: Fetch Webex rooms and unread messages, summarize conversations, prioritize for handling, and draft replies using the Webex Node.js SDK. Use when the user wants to manage Webex messages, catch up on unread, get summaries of unread conversations, prioritize which to handle first, or draft replies to send in Webex.
license: Apache-2.0
metadata:
  author: webex-skill
  version: "1.0"
compatibility: Node.js 20+, npm 10.x. WEBEX_ACCESS_TOKEN must be set in the environment.
---

# Webex Messaging

Fetch Webex rooms (direct + group, recent activity), list them, prioritize for handling, and draft replies. The script uses the **Webex REST API only** (no SDK); token from the environment—never hardcode or log.

## Prerequisites

- **Node.js 18** and **npm 10.x** (or yarn).
- **WEBEX_ACCESS_TOKEN** set in the environment. User obtains a personal access token from [Webex for Developers](https://developer.webex.com/) (Getting Started). Use for testing only; do not hardcode or log.
- Optional: **WEBEX_MAX_RECENT** (default 100) to limit how many rooms per type are requested.

If the token is missing, ask the user to set it (e.g. `export WEBEX_ACCESS_TOKEN=your_token`) and re-run.

## Quick Start

1. Ensure `WEBEX_ACCESS_TOKEN` is set.
2. Ensure node version is 18. Webex SDK doesn't work with any version > 18.
3. From the project root, run:
   ```bash
   npm install
   node scripts/fetch-unread.mjs
   ```
4. Parse the JSON from stdout. Use it to list rooms, prioritize them (see Workflow below). To summarize or draft replies you need message content—fetch messages per room via REST when needed.

The script does **not** send any messages. It returns rooms with activity in the last 24h (direct + group). Read status (unread) is **not** available from REST—output includes `readStatusUnavailable: true`.

## Workflow

### Step 1: Ensure token and run fetch script

- Check that `WEBEX_ACCESS_TOKEN` is in the environment. If not, tell the user to set it and try again.
- From the project root, run: `node scripts/fetch-unread.mjs`.
- Capture stdout. On failure the script prints a single JSON line with an `error` field and exits non-zero.

### Step 2: Use the script output

- The script outputs: `{ "rooms": [ ... ], "error": null, "readStatusUnavailable": true }`.
- Each room has `id`, `title`, `type`, `lastActivityDate`, `lastSeenDate` (null from REST). Rooms are direct + group with activity in the last 24h; no message bodies.

### Step 3: Summarize or list rooms

- Use `lastActivityDate` to see how recent each room is. For a short **gist** of what was said, fetch message content via REST (see [references/api-usage.md](references/api-usage.md)).

### Step 4: Prioritize for handling

- Order rooms for the user to handle. Suggested order:
  - Direct (1:1) rooms first, then group rooms.
  - Within each, by latest activity (most recent first).
  - Optionally boost rooms where the user is mentioned or where keywords suggest urgency.

### Step 5: Draft replies

- For each prioritized conversation (or a subset the user cares about), suggest 1–2 short reply options.
- Present as draft text the user can copy into Webex or approve for sending. Do **not** send messages automatically unless the user explicitly asks to send (e.g. "send this to that room") and you have a safe way to do so (e.g. running a send script with user-confirmed text).

## Output format

When presenting results to the user, use this structure:

```markdown
## Unread summary
- **[Room title]**: [One- or two-sentence gist of unread messages.]

## Priority order
1. [Room title] – [Brief reason, e.g. direct, latest activity]
2. ...

## Draft replies
- **[Room title]**: Suggested reply – "[draft text]"
  (Alternative: "[optional second draft]")
```

## Script usage

- **Command**: From the project root, run `node scripts/fetch-unread.mjs`.
- **Input**: None; token is read from `WEBEX_ACCESS_TOKEN`.
- **Output**: Single JSON object to stdout: `{ "rooms": [ ... ], "error": null, "readStatusUnavailable": true }`. Each room has `id`, `title`, `type`, `lastActivityDate`, `lastSeenDate` (no message bodies).
- **Errors**: Script prints `{ "rooms": [], "error": "message" }` and exits with a non-zero code. Do not log or echo the token.

For REST endpoints and optional SDK reference, see [references/api-usage.md](references/api-usage.md).

## Troubleshooting

| Issue | Cause | Action |
|-------|--------|--------|
| `WEBEX_ACCESS_TOKEN required` | Token not set | Ask user to set `WEBEX_ACCESS_TOKEN` and re-run. |
| Invalid or expired token | Token revoked or expired | User must generate a new token at Webex for Developers and update the env. |
| Empty `rooms` | No rooms with activity in last 24h, or API limit | Normal. Use `WEBEX_MAX_RECENT` to request more (default 100). |
| REST 4xx/5xx | Bad request or Webex outage | Check [Webex REST API](https://developer.webex.com/docs/api/v1/rooms/list-rooms); ensure firewall allows https://webexapis.com. |

## Sending a message (optional)

To send a message only when the user explicitly requests it (e.g. "send this reply to that room"):

1. Use the room `id` from the fetch output and the exact text the user approved.
2. Call REST `POST https://webexapis.com/v1/messages` with body `{ roomId, text }` and header `Authorization: Bearer <token>`. Read token from env only.

See [references/api-usage.md](references/api-usage.md) for REST messages and rooms.

## Resources

- [Webex Node.js SDK](https://developer.webex.com/messaging/docs/sdks/node)
- [webex-js-sdk API](https://webex.github.io/webex-js-sdk/api/)
- [Read status sample](https://webex.github.io/webex-js-sdk/samples/browser-read-status/explanation.html)
