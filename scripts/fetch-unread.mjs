#!/usr/bin/env node
import { consola } from 'consola';
import WebexNode from 'webex-node';
import dotenv from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(SCRIPT_DIR, '..', '.env');
dotenv.config({ path: ENV_PATH, quiet: true });

consola.options.stdout = process.stderr;
consola.options.stderr = process.stderr;

// consola.level = -999

const DEFAULT_MAX_RECENT = 30;
const MAX_RECENT_CAP = 1000;
/** How many rooms to ask the SDK for when scanning (must be large enough to find matches). */
const ROOMS_SCAN_LIMIT = 100;

const MESSAGES_PAGE_SIZE = 100;
const ROOM_TYPES = new Set(['direct', 'group']);
const BOT_EMAIL_SUFFIX = '@webex.bot';

/** Output: all unread direct and group rooms. mentionedMe is set per room for highlighting @mentions. */
function isOutputRoom(room) {
    return room?.type === 'direct' || room?.type === 'group';
}

/** Exclude rooms where any unread message is from a bot. */
function roomHasNoBotMessages(room) {
    const messages = room?.unreadMessages ?? [];
    const hasBot = messages.some((m) => String(m?.personEmail ?? '').endsWith(BOT_EMAIL_SUFFIX));
    return !hasBot;
}
const SDK_READY_TIMEOUT_MS = 60000;

function out(result) {
    console.log(JSON.stringify(result));
}

/** Max number of rooms to return (direct + mentionedMe). From WEBEX_MAX_RECENT. */
function getMaxRoomsToReturn() {
    const raw = process.env.WEBEX_MAX_RECENT;
    if (!raw) return DEFAULT_MAX_RECENT;
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_RECENT;
    return Math.min(n, MAX_RECENT_CAP);
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

function extractRoomItems(roomsResponse) {
    if (Array.isArray(roomsResponse)) return roomsResponse;
    if (Array.isArray(roomsResponse?.items)) return roomsResponse.items;
    return [];
}

function extractMessageItems(messagesResponse) {
    if (Array.isArray(messagesResponse)) return messagesResponse;
    if (Array.isArray(messagesResponse?.items)) return messagesResponse.items;
    return [];
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
    const messages = extractMessageItems(messagesResponse);
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

/** Build people map: key = personEmail, value = personId. Also slim messages (remove roomId, personId). */
function buildPeopleAndSlimMessages(roomsWithMessages) {
    const people = Object.create(null);
    for (const room of roomsWithMessages) {
        for (const message of room.unreadMessages || []) {
            const email = message.personEmail ?? null;
            const pid = message.personId;
            if (email && pid && people[email] === undefined) {
                people[email] = pid;
            }
            delete message.roomId;
            delete message.personId;
            delete message.roomType;
            delete message.created;
            delete message.updated;
            if (message.markdown != null) {
                delete message.text;
            }
            if (message.html != null) {
                delete message.markdown;
                delete message.text;
            }
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
            // supertoken: { access_token: accessToken }
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

    const maxRoomsToReturn = getMaxRoomsToReturn();
    consola.info(`maxRoomsToReturn=${maxRoomsToReturn}`);

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
    const rooms = extractRoomItems(roomsResponse);
    consola.info('me:', me);

    const normalized = rooms
        .map(normalizeRoom)
        .filter((r) => ROOM_TYPES.has(r.type))
        .filter((r) => inLastXhours(r, 24))
        .sort((a, b) => toTs(b.lastActivityDate) - toTs(a.lastActivityDate));

    const unread = normalized.filter((r) => r.isUnread);
    const unreadWithMessages = await attachUnreadMessages(webex, unread, me?.id);
    const roomsFiltered = unreadWithMessages
        .filter(isOutputRoom)
        .filter(roomHasNoBotMessages)
        .slice(0, maxRoomsToReturn);
    for (const room of roomsFiltered) {
        if (room.type === 'direct' && room.unreadMessages?.length > 0) {
            const lastMessage = room.unreadMessages[room.unreadMessages.length - 1];
            if (lastMessage.personEmail) room.title = lastMessage.personEmail;
        }
    }
    const people = buildPeopleAndSlimMessages(roomsFiltered);
    out({
        rooms: roomsFiltered,
        people,
        stats: {
            total: normalized.length,
            unread: roomsFiltered.length,
            read: normalized.length - unreadWithMessages.length,
        },
        error: null,
    });
    process.exit(0);
}

main().catch((err) => {
    consola.error(err?.message || err);
    out({ rooms: [], error: err?.message || String(err) });
    process.exit(1);
});
