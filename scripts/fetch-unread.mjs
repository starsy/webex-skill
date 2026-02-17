#!/usr/bin/env node
/**
 * Fetch unread Webex rooms (direct + group) with messages.
 *
 * Writes the result to output/message-history-<since>-<to>.json and prints only
 * the output file path to stdout. The agent should read that file and extract
 * rooms and messages using appropriate tools.
 *
 * Options (CLI overrides env):
 *   --hours, -H         Only rooms with activity in the last N hours (default: 24)
 *   --max-rooms, -n     Max number of rooms to return (default: WEBEX_MAX_RECENT or 30)
 *
 * Env: WEBEX_ACCESS_TOKEN (required), WEBEX_MAX_RECENT, WEBEX_ACTIVITY_HOURS
 */
import { consola } from 'consola';
import WebexNode from 'webex-node';
import dotenv from 'dotenv';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIR, '..');
const ENV_PATH = resolve(PROJECT_ROOT, '.env');
const OUTPUT_DIR = resolve(PROJECT_ROOT, 'output');
dotenv.config({ path: ENV_PATH, quiet: true });

consola.options.stdout = process.stderr;
consola.options.stderr = process.stderr;

const DEFAULT_MAX_RECENT = 30;
const MAX_RECENT_CAP = 1000;
const ROOMS_SCAN_LIMIT = 100;
const MESSAGES_PAGE_SIZE = 100;
const DEFAULT_ACTIVITY_HOURS = 24;
const MIN_ACTIVITY_HOURS = 1;
const MAX_ACTIVITY_HOURS = 720; // 30 days
const SDK_READY_TIMEOUT_MS = 60_000;

const ROOM_TYPES = new Set(['direct', 'group']);
const BOT_EMAIL_SUFFIX = '@webex.bot';

function extractItems(response) {
    if (Array.isArray(response)) return response;
    if (Array.isArray(response?.items)) return response.items;
    return [];
}

function isOutputRoom(room) {
    return ROOM_TYPES.has(room?.type);
}

function roomHasNoBotMessages(room) {
    return !(room?.unreadMessages ?? []).some((m) =>
        String(m?.personEmail ?? '').endsWith(BOT_EMAIL_SUFFIX),
    );
}

/** Print a single JSON line to stdout (for agent consumption). */
function out(result) {
    console.log(JSON.stringify(result));
}

/** ISO-like string safe for filenames: 2026-02-15T12-00-00Z (colons replaced). */
function toFileSafeIso(date) {
    return date.toISOString().replace(/:/g, '-').replace(/\.\d{3}/, '');
}

function parseArgs(argv = process.argv.slice(2)) {
    const opts = { hours: null, maxRooms: null };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--hours' || arg === '-H') {
            opts.hours = argv[++i];
        } else if (arg === '--max-rooms' || arg === '-n') {
            opts.maxRooms = argv[++i];
        } else if (arg.startsWith('--hours=')) {
            opts.hours = arg.slice(8);
        } else if (arg.startsWith('--max-rooms=')) {
            opts.maxRooms = arg.slice(12);
        }
    }
    return opts;
}

/** Max number of rooms to return. CLI/Webex max-rooms overrides WEBEX_MAX_RECENT. */
function getMaxRoomsToReturn(cliMaxRooms = null) {
    const raw = cliMaxRooms ?? process.env.WEBEX_MAX_RECENT;
    if (raw === null || raw === undefined || raw === '') return DEFAULT_MAX_RECENT;
    const n = parseInt(String(raw), 10);
    if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_RECENT;
    return Math.min(n, MAX_RECENT_CAP);
}

function getActivityHours(cliHours = null) {
    const raw = cliHours ?? process.env.WEBEX_ACTIVITY_HOURS;
    if (raw === null || raw === undefined || raw === '') return DEFAULT_ACTIVITY_HOURS;
    const n = parseInt(String(raw), 10);
    if (!Number.isFinite(n) || n < MIN_ACTIVITY_HOURS) return DEFAULT_ACTIVITY_HOURS;
    return Math.min(n, MAX_ACTIVITY_HOURS);
}

function toTs(value) {
    if (!value) return 0;
    const t = new Date(value).getTime();
    return Number.isFinite(t) ? t : 0;
}

function withTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timeout (${ms}ms)`)), ms)),
    ]);
}

function normalizeRoom(room) {
    const lastActivityDate = room.lastActivityDate || room.lastActivity || null;
    const lastSeenDate = room.lastSeenDate || room.lastSeenActivityDate || null;
    return {
        id: room.id,
        title: room.title || room.id,
        type: room.type || room.roomType || 'group',
        lastActivityDate,
        lastSeenDate,
        isUnread: toTs(lastActivityDate) > toTs(lastSeenDate),
    };
}

function inLastXhours(room, hours = 24) {
    const ACTIVITY_FROM_MS = hours * 60 * 60 * 1000;
    const cutoff = Date.now() - ACTIVITY_FROM_MS;
    return toTs(room.lastActivityDate) >= cutoff;
}

function isUnreadMessage(message, lastSeenTs, meId) {
    const createdTs = toTs(message?.created);
    if (createdTs <= lastSeenTs) return false;
    return message?.personId !== meId;
}

async function getUnreadMessages(webex, room, meId) {
    const messagesResponse = await webex.messages.list({
        roomId: room.id,
        max: MESSAGES_PAGE_SIZE,
    });
    const messages = extractItems(messagesResponse);
    const lastSeenTs = toTs(room.lastSeenDate);
    return messages
        .filter((message) => isUnreadMessage(message, lastSeenTs, meId))
        .sort((a, b) => toTs(a.created) - toTs(b.created));
}

function roomMentionsMe(unreadMessages, meId) {
    if (!meId || !Array.isArray(unreadMessages)) return false;
    return unreadMessages.some(
        (m) => Array.isArray(m.mentionedPeople) && m.mentionedPeople.includes(meId),
    );
}

function setDirectRoomTitles(rooms) {
    for (const room of rooms) {
        if (room.type !== 'direct' || !room.unreadMessages?.length) continue;
        const email = room.unreadMessages[room.unreadMessages.length - 1].personEmail;
        if (email) room.title = email;
    }
}

function slimMessage(message) {
    delete message.roomId;
    delete message.personId;
    delete message.roomType;
    delete message.created;
    delete message.updated;
    if (message.markdown != null) delete message.text;
    if (message.html != null) {
        delete message.markdown;
        delete message.text;
    }
}

function buildPeopleAndSlimMessages(roomsWithMessages) {
    const people = Object.create(null);
    for (const room of roomsWithMessages) {
        for (const message of room.unreadMessages || []) {
            const email = message.personEmail ?? null;
            const pid = message.personId;
            if (email && pid && people[email] === undefined) people[email] = pid;
            slimMessage(message);
        }
    }
    return people;
}

async function attachUnreadMessages(webex, unreadRooms, meId) {
    return Promise.all(
        unreadRooms.map(async (room) => {
            try {
                const unreadMessages = await getUnreadMessages(webex, room, meId);
                const mentionedMe = roomMentionsMe(unreadMessages, meId);
                return {
                    ...room,
                    unreadMessages,
                    unreadMessageCount: unreadMessages.length,
                    mentionedMe,
                };
            } catch (err) {
                consola.warn(`Failed to get unread messages for room ${room.id}: ${err?.message || err}`);
                return { ...room, unreadMessages: [], unreadMessageCount: 0, mentionedMe: false };
            }
        }),
    );
}

async function initWebex(accessToken) {
    const webex = WebexNode.init({
        credentials: {
            access_token: accessToken,
            clientType: 'confidential',
        },
        hydra: process.env.HYDRA_SERVICE_URL || 'https://webexapis.com/v1',
        hydraServiceUrl: process.env.HYDRA_SERVICE_URL || 'https://webexapis.com/v1',
        config: {
            services: {
                discovery: {
                    hydra: process.env.HYDRA_SERVICE_URL || 'https://api.ciscospark.com/v1',
                    u2c: process.env.U2C_SERVICE_URL || 'https://u2c.wbx2.com/u2c/api/v1',
                },
            },
            device: {
                validateDomains: true,
                ephemeral: true,
            },
            validateDomains: true,
        },
    });

    await withTimeout(new Promise((resolve, reject) => {
        webex.once('ready', resolve);
        webex.once('error', reject);
    }), SDK_READY_TIMEOUT_MS, 'SDK ready');
    if (!webex.canAuthorize) throw new Error('SDK not authorized');

    return webex;
}

async function main() {
    consola.box('Webex read-status');
    const token = process.env.WEBEX_ACCESS_TOKEN;
    if (!token || !token.trim()) {
        out({ rooms: [], error: 'WEBEX_ACCESS_TOKEN required' });
        process.exit(1);
    }

    const cli = parseArgs();
    const activityHours = getActivityHours(cli.hours);
    const maxRoomsToReturn = getMaxRoomsToReturn(cli.maxRooms);
    consola.info(`activityHours=${activityHours}, maxRoomsToReturn=${maxRoomsToReturn}`);

    let webex;
    try {
        consola.info(`Initializing Webex SDK`);
        webex = await initWebex(token);
        consola.success('SDK authorized and preauth catalog ready');
    } catch (err) {
        const msg = err?.message || String(err);
        consola.warn(`SDK init attempt failed: ${msg}`);
        process.exit(1);
    }

    consola.info('Listing rooms with read status');
    const [roomsResponse, me] = await Promise.all([
        webex.rooms.listWithReadStatus(ROOMS_SCAN_LIMIT),
        webex.people.get('me'),
    ]);
    const rooms = extractItems(roomsResponse);
    consola.info('me:', me);

    const normalized = rooms
        .map(normalizeRoom)
        .filter((r) => ROOM_TYPES.has(r.type))
        .filter((r) => inLastXhours(r, activityHours))
        .sort((a, b) => toTs(b.lastActivityDate) - toTs(a.lastActivityDate));

    const unread = normalized.filter((r) => r.isUnread);
    const unreadWithMessages = await attachUnreadMessages(webex, unread, me?.id);
    const roomsFiltered = unreadWithMessages
        .filter(isOutputRoom)
        .filter(roomHasNoBotMessages)
        .slice(0, maxRoomsToReturn);
    setDirectRoomTitles(roomsFiltered);
    const people = buildPeopleAndSlimMessages(roomsFiltered);
    const payload = {
        rooms: roomsFiltered,
        people,
        stats: {
            total: normalized.length,
            unread: roomsFiltered.length,
            read: normalized.length - unread.length,
        },
        error: null,
    };

    const since = new Date(Date.now() - activityHours * 60 * 60 * 1000);
    const to = new Date();
    const filename = `message-history-${toFileSafeIso(since)}-${toFileSafeIso(to)}.json`;
    await mkdir(OUTPUT_DIR, { recursive: true });
    const outputPath = resolve(OUTPUT_DIR, filename);
    await writeFile(outputPath, JSON.stringify(payload, null, 0), 'utf8');
    consola.success(`Wrote ${outputPath}`);
    out({ outputPath, error: null });
    process.exit(0);
}

main().catch((err) => {
    consola.error(err?.message || err);
    out({ outputPath: null, error: err?.message || String(err) });
    process.exit(1);
});
