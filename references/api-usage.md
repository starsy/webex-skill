# Webex Node.js SDK – API usage reference

Short reference for the SDK calls used by the webex-messaging skill. The `webex-node` package is for **Messaging only** (not Meetings or Calling).

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `WEBEX_ACCESS_TOKEN` | Yes | Personal access token from [Webex for Developers](https://developer.webex.com/). Used for all API calls. Never hardcode or log. |
| `WEBEX_LOG_LEVEL` | No | Log level for the SDK (e.g. `debug`, `info`). Use for troubleshooting. |

## Initialization

```javascript
import WebexNode from 'webex-node';

const webex = WebexNode.init({
  credentials: { access_token: process.env.WEBEX_ACCESS_TOKEN },
});

await new Promise((resolve, reject) => {
  webex.once('ready', resolve);
  webex.once('error', reject);
});

if (!webex.canAuthorize) {
  // Token invalid or not authorized
}
```

## Rooms with read status

- **`webex.rooms.listWithReadStatus(options)`**
  - **Options**: `{ maxRecent?: number }` – limit to N rooms with recent activity (e.g. `30` or `100`) for faster response. Without it, returns up to **1000** rooms.
  - **Returns**: List of room objects. Each room includes:
    - `id`, `title`, `type` (e.g. `direct`, `group`)
    - `lastSeenDate` – when the user last viewed the space
    - `lastActivityDate` – when the latest activity occurred in the space
  - **Unread**: A room has unread messages when `lastActivityDate` > `lastSeenDate` or `lastSeenDate` is missing.

- **`webex.rooms.getWithReadStatus(roomId)`** – Same read-status fields for a single room (e.g. when you receive an event for a new space).

## Messages

- **`webex.messages.list(options)`**
  - **Options**: `{ roomId: string, max?: number, before?: string, beforeMessage?: string }`
  - **Returns**: List of messages (e.g. `items` array). Each message has `id`, `text`, `personId`, `created`, etc.

- **`webex.messages.create(options)`**
  - **Options**: `{ roomId: string, text: string }` (and optional markdown/file params per REST API).
  - **Use**: Only when the user explicitly asks to send a message. Read token from `process.env.WEBEX_ACCESS_TOKEN`.

## Memberships (read receipts)

- **`webex.memberships.listWithReadStatus(roomId)`** – List members in a space with `lastSeenId` and `lastSeenDate` per member.
- **`webex.memberships.updateLastSeen(roomId, message)`** – Mark the space as read up to the given message (pass the message object). Updates `lastSeenId` and `lastSeenDate` for the current user.

## Limits

- **List rooms**: Up to **1000** rooms returned. Use `maxRecent` to get a smaller set with recent activity first.
- **List messages**: Use `max` (e.g. 50) to limit; REST API supports pagination via `before` / `beforeMessage`.

## Official documentation

- [Webex Node.js SDK](https://developer.webex.com/messaging/docs/sdks/node)
- [webex-js-sdk API reference](https://webex.github.io/webex-js-sdk/api/)
- [Read status sample](https://webex.github.io/webex-js-sdk/samples/browser-read-status/explanation.html)
- [Webex API and SDK support policy](https://developer.webex.com/docs/support)
