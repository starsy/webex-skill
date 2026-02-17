---
name: webex-messaging
description: Fetch Webex rooms and unread messages, summarize conversations, prioritize for handling, and send messages using the Webex Node.js SDK. Use when the user wants to manage Webex messages, catch up on unread, get summaries of unread conversations, prioritize which to handle first, draft replies, or send a message to a room or person.
license: Apache-2.0
metadata:
  author: webex-skill
  version: "1.0"
compatibility: Node.js <= 18, npm 10.x. WEBEX_ACCESS_TOKEN must be set in the environment.
---

# Webex Messaging

Fetch Webex rooms (direct + group) with unread messages and read status, list them, prioritize for handling, draft replies, and optionally send messages—using the **Webex Node.js SDK**. Token and options come from the environment or CLI; never hardcode or log the token.

## Prerequisites

- **Node.js <= 18** and **npm 10.x** (or yarn).
- Change working directory to `~/.openclaw/workspace/skills/webex-skill` before executing scripts
- Node 18 has been installed via brew at `/opt/homebrew/opt/node@18/bin/node`
- **WEBEX_ACCESS_TOKEN** set in the `~/.openclaw/workspace/skills/webex-skill/.env`. Obtain a personal access token from [Webex for Developers](https://developer.webex.com/) (Getting Started). Use for testing only; do not hardcode or log.
- Optional env: **WEBEX_MAX_RECENT** (default 30), **WEBEX_ACTIVITY_HOURS** (default 24). These can be overridden by CLI options.

If the token is missing, ask the user to set it (e.g. in `~/.openclaw/workspace/skills/webex-skill/.env`) and re-run.

## Quick Start

1. Ensure `WEBEX_ACCESS_TOKEN` is set (e.g. in `.env` in the project root).
2. Always use `/opt/homebrew/opt/node@18/bin/node` as `node`, `export NODE=/opt/homebrew/opt/node@18/bin/node`
3. From the project root:
   ```bash
   cd ~/.openclaw/workspace/skills/webex-skill
   source .env && $NODE scripts/fetch-unread.mjs
   ```
   Optional CLI: `node scripts/fetch-unread.mjs --hours 12 --max-rooms 10`.
4. Parse the JSON line from stdout: `{ "outputPath": "<path>", "error": null }`. The message fetch result is saved under the `output/` folder as `message-history-<since>-<to>.json`. **Use the returned `outputPath` and read that file with your tools to extract rooms and messages**; do not expect the full payload on stdout.
5. To send a message to a room or person:
   ```bash
   cd ~/.openclaw/workspace/skills/webex-skill
   source .env && $NODE scripts/send-message.mjs --to user@example.com --message "**Hello** in markdown"
   source .env && $NODE scripts/send-message.mjs -t ROOM_ID -m "Room message"
   ```

The fetch script writes **unread** direct and group rooms (with message bodies and read status) to a JSON file in `output/` and prints only the file path to stdout. The send script posts a **markdown** message to a room ID or person email.

## Workflow

### Output Style

- Output your reply in markdown format. Always quote room name or people's name like this: `room_name` or `people_name`.
- Never use "```markdown" to quote the reply which is in markdown format, Webex knows how to interprete and render markdown content.
- If user is talking to you via a Webex channel, please convert the markdown table into a list before replying -- Webex client doesn't render markdown table. Use markdown table in conversation via webchat channel is perfectly fine.

### Step 1: Ensure token and run fetch script

- Check that `WEBEX_ACCESS_TOKEN` is set in `~/.openclaw/workspace/skills/webex-skill/.env`. If not, tell the user to set it and try again.
- From the project root (`~/.openclaw/workspace/skills/webex-skill/`), run: `node scripts/fetch-unread.mjs` (optionally with `--hours N` and `--max-rooms N`).
- Capture stdout: one JSON line `{ "outputPath": "<absolute path>", "error": null }`. On failure: `{ "outputPath": null, "error": "message" }` and exits non-zero.
- **Read the file at `outputPath`** using your file-read tool to get the full result. Do not parse rooms from stdout.

### Step 2: Use the script output file

- The file at `outputPath` contains: `{ "rooms": [ ... ], "people": { ... }, "stats": { ... }, "error": null }`.
- Each room has `id`, `title`, `type`, `lastActivityDate`, `lastSeenDate`, `isUnread`, `unreadMessages`, `unreadMessageCount`, `mentionedMe`. Direct room titles are normalized to the other person’s email. Rooms are direct + group with unread activity in the last N hours (default 24); rooms where every unread message is from a bot are excluded.

### Step 3: Summarize or list rooms

- Use `lastActivityDate` and `unreadMessages` (text/markdown/html) for a short **gist**. The `people` map keys emails to person IDs.

### Step 4: Prioritize for handling

- Order rooms for the user. Suggested order:
  - Direct (1:1) rooms first, then group rooms.
  - Within each, by latest activity (most recent first).
  - Boost rooms where `mentionedMe` is true or keywords suggest urgency.

### Step 5: Draft replies and optionally send

- For each prioritized conversation, suggest 1–2 short reply options as draft text.
- Only send when the user explicitly asks (e.g. “send this to that room”). Then run `node scripts/send-message.mjs --to <roomId_or_email> --message "<user-approved text>"`.

## Output format

When presenting results to the user, use this markdown structure:

```
## Unread summary
- **[Room title]**: [3 - 5 sentence gist of unread messages.]

## Priority order
1. [Room title] – [Brief reason, e.g. direct, latest activity]
2. ...

## Draft replies
- **[Room title]**: Suggested reply – "[draft text]"
  (Alternative: "[optional second draft]")
```

## Script usage

### fetch-unread.mjs

- **Command**: `source .env && $NODE scripts/fetch-unread.mjs` (from project root).
- **CLI options** (override env when provided):

  | Option | Short | Description | Default / env |
  |--------|--------|--------------|----------------|
  | `--hours` | `-H` | Only rooms with activity in the last N hours | 24 / WEBEX_ACTIVITY_HOURS |
  | `--max-rooms` | `-n` | Max number of rooms to return | 30 / WEBEX_MAX_RECENT |

  Examples: `--hours 12 --max-rooms 10`, `-H 48 -n 5`, `--hours=6 --max-rooms=20`.
- **Input**: Token from `WEBEX_ACCESS_TOKEN`; optional env `WEBEX_MAX_RECENT`, `WEBEX_ACTIVITY_HOURS`.
- **Output**: Writes the full result to `output/message-history-<since>-<to>.json` (since/to are ISO-like timestamps in the filename). Prints a single JSON line to stdout: `{ "outputPath": "<absolute path to file>", "error": null }`. **Extract rooms and messages by using `jq` to read from the json file at `outputPath`** (e.g. with a read-file tool); do not expect the payload on stdout.
- **Errors**: Prints `{ "outputPath": null, "error": "message" }` and exits non-zero. Do not log or echo the token.

#### Response schema (fetch-unread.mjs)

Schema of the **JSON file** written to `outputPath` (not stdout). Use this to construct `jq` query when parsing the file to extract rooms and messages:

```yaml
type: object
properties:
  rooms:
    type: array
    items:
      type: object
      properties:
        id: string
        title: string
        type: string
        lastActivityDate: string   # ISO datetime
        lastSeenDate: string | null
        isUnread: boolean
        unreadMessageCount: integer
        unreadMessages:
          type: array
          items:
            type: object
            properties:
              id: string
              text: string?
              html: string?
              personEmail: string?
              files: array<string>?
              mentionedPeople: array<string>?
              parentId: string?
              isVoiceClip: boolean?
        mentionedMe: boolean
  people:
    type: object
    additionalProperties: string   # maps email → personId
  stats:
    type: object
    properties:
      total: integer
      unread: integer
      read: integer
  error:
    type: string | null
required: [rooms, people, stats, error]
```

### send-message.mjs

- **Command**: `source .env && $NODE scripts/send-message.mjs` (from project root).
- **CLI options** (override env when provided):

  | Option | Short | Description | Default / env |
  |--------|--------|--------------|----------------|
  | `--to` | `-t` | Room ID or person email (recipient) | WEBEX_TO |
  | `--message` | `-m` | Markdown body of the message | WEBEX_MESSAGE or stdin |

  Examples: `--to user@example.com --message "**Hello**"`, `-t ROOM_ID -m "Hi"`, `echo "Body" | node scripts/send-message.mjs --to user@example.com`.
- **Input**: Token from `WEBEX_ACCESS_TOKEN`; recipient and body from CLI or env (or message from stdin).
- **Output**: Success: `{ "ok": true, "message": { "id", "roomId", "created" }, "error": null }`. Failure: `{ "ok": false, "error": "message" }`.
- **Behavior**: If `--to`/`WEBEX_TO` contains `@`, the message is sent to that person (1:1); otherwise it is treated as a room ID.
- **--message option**: The message content to be sent must be quoted properly as an CLI option.

For REST endpoints and optional SDK reference, see [references/api-usage.md](references/api-usage.md).

## Troubleshooting

| Issue | Cause | Action |
|-------|--------|--------|
| `WEBEX_ACCESS_TOKEN required` | Token not set | Ask user to set `WEBEX_ACCESS_TOKEN` (e.g. in `.env`) and re-run. |
| Invalid or expired token | Token revoked or expired | User must generate a new token at Webex for Developers and update the env. |
| `outputPath` is null | Script failed (see `error` on stdout) | Fix token, network, or SDK issue; re-run. |
| Empty `rooms` in file | No unread rooms in the time window, or filters exclude all | After reading the file at `outputPath`, if `rooms` is empty try `--hours 48` or `--max-rooms`; check direct/group and bot filters. |
| SDK / network errors | Webex outage or firewall | Ensure firewall allows https://webexapis.com and discovery endpoints; see [references/api-usage.md](references/api-usage.md). |
| send-message: `--to` or WEBEX_TO required | Recipient not provided | Pass `--to <roomId_or_email>` or set WEBEX_TO. |


## Sending a message (optional)

When the user explicitly asks to send a message (e.g. “send this reply to that room”):

1. Get the room `id` or person email from the **message history file** at `outputPath` (e.g. `rooms[].id` for room ID, or `rooms[].title` for direct-DM email). Use the **exact** text the user approved.
2. Run: `node scripts/send-message.mjs --to <roomId_or_email> --message "<user-approved markdown>"` (or set `WEBEX_TO` and `WEBEX_MESSAGE` / stdin). Token is read from env only; never hardcode it.

See [references/api-usage.md](references/api-usage.md) for REST/SDK reference.

## Resources

- [Webex Node.js SDK](https://developer.webex.com/messaging/docs/sdks/node)
- [webex-js-sdk API](https://webex.github.io/webex-js-sdk/api/)
- [Read status sample](https://webex.github.io/webex-js-sdk/samples/browser-read-status/explanation.html)
