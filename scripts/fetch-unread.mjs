#!/usr/bin/env node
import { consola } from 'consola';
import WebexNode from 'webex-node';
// import webex from 'webex';
import { getHydraRoomType, getHydraClusterString, buildHydraRoomId } from '@webex/common/dist/uuid-utils.js';
import dotenv from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(SCRIPT_DIR, '..', '.env');
dotenv.config({ path: ENV_PATH, quiet: true });

consola.options.stdout = process.stderr;
consola.options.stderr = process.stderr;

consola.level = -999

const DEFAULT_MAX_RECENT = 30;
const MAX_RECENT_CAP = 1000;
const ACTIVITY_FROM_MS = 24 * 60 * 60 * 1000;
const MESSAGES_PAGE_SIZE = 100;
const ROOM_TYPES = new Set(['direct', 'group']);
const SDK_READY_TIMEOUT_MS = 60000;

function out(result) {
    console.log(JSON.stringify(result));
}

function getMaxRecent() {
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

function inLast24h(room) {
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

async function getUnreadMessageCount(webex, room, meId) {
    const messagesResponse = await webex.messages.list({
        roomId: room.id,
        max: MESSAGES_PAGE_SIZE,
    });
    const messages = extractMessageItems(messagesResponse);
    const lastSeenTs = toTs(room.lastSeenDate);
    return messages.filter((message) => {
        const createdTs = toTs(message?.created);
        if (createdTs <= lastSeenTs) return false;
        return message?.personId !== meId;
    }).length;
}

async function attachUnreadMessageCounts(webex, unreadRooms, meId) {
    return Promise.all(
        unreadRooms.map(async (room) => {
            try {
                const unreadMessageCount = await getUnreadMessageCount(webex, room, meId);
                return { ...room, unreadMessageCount };
            } catch (err) {
                consola.warn(`Failed to get unread message count for room ${room.id}: ${err?.message || err}`);
                return { ...room, unreadMessageCount: 0 };
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
            // allowedDomains: ['wbx2.com', 'ciscospark.com', 'webex.com', 'webexapis.com', 'localhost'],
        },
    });


    await withTimeout(new Promise((resolve, reject) => {
        webex.once('ready', resolve);
        webex.once('error', reject);
    }), SDK_READY_TIMEOUT_MS, 'SDK ready');
    if (!webex.canAuthorize) throw new Error('SDK not authorized');

    const me = await webex.people.get('me');
    consola.log('me', me);

    return webex;
}

async function main() {
    consola.box('Webex read-status');
    const token = process.env.WEBEX_ACCESS_TOKEN;
    if (!token || !token.trim()) {
        out({ rooms: [], error: 'WEBEX_ACCESS_TOKEN required' });
        process.exit(1);
    }

    const maxRecent = getMaxRecent();
    consola.info(`maxRecent=${maxRecent}`);

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
    const roomsResponse = await webex.rooms.listWithReadStatus(maxRecent);
    const rooms = extractRoomItems(roomsResponse);
    const me = await webex.people.get('me');

    const normalized = rooms
        .map(normalizeRoom)
        .filter((r) => ROOM_TYPES.has(r.type))
        .filter(inLast24h)
        .sort((a, b) => toTs(b.lastActivityDate) - toTs(a.lastActivityDate));

    const unread = normalized.filter((r) => r.isUnread);
    const unreadWithCounts = await attachUnreadMessageCounts(webex, unread, me?.id);
    out({
        rooms: unreadWithCounts,
        stats: {
            total: normalized.length,
            unread: unreadWithCounts.length,
            read: normalized.length - unreadWithCounts.length,
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
