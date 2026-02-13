---
name: webex-messaging
description: Fetch Webex rooms and unread messages, summarize conversations, prioritize for handling, and draft replies using the Webex Node.js SDK. Use when the user wants to manage Webex messages, catch up on unread, get summaries of unread conversations, prioritize which to handle first, or draft replies to send in Webex.
license: Apache-2.0
metadata:
  author: webex-skill
  version: "1.0"
compatibility: Node.js 20+, npm 10.x, webex-node package. WEBEX_ACCESS_TOKEN must be set in the environment.
---

# Webex Messaging

Manage Webex rooms and unread messages: fetch rooms with read status, summarize unread conversations, prioritize them, and draft replies. Uses the Webex Node.js SDK with the user's personal access token from the environment only—never hardcode or log the token.

## Prerequisites

- **Node.js 20+** and **npm 10.x** (or yarn).
- **webex-node** installed: run `npm install` from the project root (see [package.json](package.json)).
- **WEBEX_ACCESS_TOKEN** set in the environment. User obtains a personal access token from [Webex for Developers](https://developer.webex.com/) (Getting Started). Use for testing only; do not hardcode or log.

If the token is missing, ask the user to set it (e.g. `export WEBEX_ACCESS_TOKEN=your_token`) and re-run.

## Quick Start

1. Ensure `WEBEX_ACCESS_TOKEN` is set.
2. From the project root, run:
   ```bash
   npm install
   node scripts/fetch-unread.mjs
   ```
3. Parse the JSON from stdout. Use it to list unread rooms, prioritize them (see Workflow below). To summarize or draft replies you need message content—fetch messages per room (e.g. `messages.list`) when needed.

The script does **not** send any messages; it only lists rooms that have unread (no message bodies fetched).

## Workflow

### Step 1: Ensure token and run fetch script

- Check that `WEBEX_ACCESS_TOKEN` is in the environment. If not, tell the user to set it and try again.
- From the project root, run: `node scripts/fetch-unread.mjs`.
- Capture stdout. On failure the script prints a single JSON line with an `error` field and exits non-zero.

### Step 2: Use the script output

- The script outputs: `{ "rooms": [ ... ], "error": null }`.
- Each room has `id`, `title`, `type`, `lastActivityDate`, `lastSeenDate`. The script only includes rooms that have unread (no `messages` array—it does not fetch message bodies).

### Step 3: Summarize or list unread rooms

- From room metadata you can list which spaces have unread and how recent they are (`lastActivityDate`). For a short **gist** of what was said, you need message content—use `webex.messages.list({ roomId, max })` for chosen rooms (see [references/api-usage.md](references/api-usage.md)).

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
- **Output**: Single JSON object to stdout: `{ "rooms": [ ... ], "error": null }`. Each room has `id`, `title`, `type`, `lastActivityDate`, `lastSeenDate` (no message bodies).
- **Errors**: Script prints `{ "rooms": [], "error": "message" }` and exits with a non-zero code. Do not log or echo the token.

For detailed SDK calls and limits, see [references/api-usage.md](references/api-usage.md).

## Troubleshooting

| Issue | Cause | Action |
|-------|--------|--------|
| `WEBEX_ACCESS_TOKEN required` | Token not set | Ask user to set `WEBEX_ACCESS_TOKEN` and re-run. |
| Invalid or expired token | Token revoked or expired | User must generate a new token at Webex for Developers and update the env. |
| Empty `rooms` or no unread | No unread spaces, or API limit | Normal if user is caught up. Script uses `maxRecent: 100`; see [references/api-usage.md](references/api-usage.md) for caps. |
| SDK/network errors | Connectivity or Webex outage | Check [Webex Node SDK Troubleshooting](https://developer.webex.com/messaging/docs/sdks/node#troubleshooting). Set `WEBEX_LOG_LEVEL=debug` for more detail. |

## Sending a message (optional)

To send a message only when the user explicitly requests it (e.g. "send this reply to that room"):

1. Use the room `id` from the fetch output and the exact text the user approved.
2. Run a small script or one-off code that calls `webex.messages.create({ roomId, text })` with the token from env. Do not embed the token in code; read from `process.env.WEBEX_ACCESS_TOKEN`.

See [references/api-usage.md](references/api-usage.md) for `messages.create` and `memberships.updateLastSeen` (mark as read).

## Resources

- [Webex Node.js SDK](https://developer.webex.com/messaging/docs/sdks/node)
- [webex-js-sdk API](https://webex.github.io/webex-js-sdk/api/)
- [Read status sample](https://webex.github.io/webex-js-sdk/samples/browser-read-status/explanation.html)
