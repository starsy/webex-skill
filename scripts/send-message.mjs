#!/usr/bin/env node
/**
 * Send a Webex message in markdown to a room or person.
 *
 * Usage:
 *   node scripts/send-message.mjs --to user@example.com --message "**Hello** world"
 *   node scripts/send-message.mjs -t roomId -m "Hi"
 *   echo "Body" | node scripts/send-message.mjs --to user@example.com
 *
 * Options (CLI overrides env):
 *   --to, -t       Room ID or person email (env: WEBEX_TO)
 *   --message, -m  Markdown body (env: WEBEX_MESSAGE); optional if stdin used
 *
 * Env:
 *   WEBEX_ACCESS_TOKEN - required
 */
import { Command } from 'commander';
import {
    consola,
    initWebex,
    loadEnv,
    out,
    setupConsola,
} from './webex-common.mjs';

loadEnv(import.meta.url);
setupConsola();

function isEmail(value) {
    return typeof value === 'string' && value.includes('@');
}

const sendMessageProgram = new Command();
sendMessageProgram
    .option('-t, --to <to>', 'Room ID or person email (recipient)')
    .option('-m, --message <message>', 'Markdown body of the message');

async function main() {
    const token = process.env.WEBEX_ACCESS_TOKEN;
    if (!token?.trim()) {
        out({ ok: false, error: 'WEBEX_ACCESS_TOKEN required' });
        process.exit(1);
    }

    sendMessageProgram.parse(process.argv);
    const opts = sendMessageProgram.opts();
    const to = (opts.to ?? process.env.WEBEX_TO ?? '').trim();
    if (!to) {
        out({ ok: false, error: '--to / -t or WEBEX_TO required (room ID or person email)' });
        process.exit(1);
    }

    let markdown = (opts.message ?? process.env.WEBEX_MESSAGE ?? '').trim();
    if (!markdown) {
        out({ ok: false, error: '--message / -m, WEBEX_MESSAGE, or stdin required' });
        process.exit(1);
    }

    let webex;
    try {
        webex = await initWebex(token);
    } catch (err) {
        const msg = err?.message ?? String(err);
        consola.warn(`SDK init failed: ${msg}`);
        out({ ok: false, error: msg });
        process.exit(1);
    }

    const payload = isEmail(to)
        ? { toPersonEmail: to, markdown }
        : { roomId: to, markdown };

    try {
        const message = await webex.messages.create(payload);
        out({
            ok: true,
            message: {
                id: message.id,
                roomId: message.roomId,
                created: message.created,
            },
            error: null,
        });
        process.exit(0);
    } catch (err) {
        const msg = err?.message ?? String(err);
        consola.error(msg);
        out({ ok: false, error: msg });
        process.exit(1);
    }
}

main();
