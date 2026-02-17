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
import { consola } from 'consola';
import WebexNode from 'webex-node';
import dotenv from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(SCRIPT_DIR, '..', '.env');
dotenv.config({ path: ENV_PATH, quiet: true });

consola.options.stdout = process.stderr;
consola.options.stderr = process.stderr;

const SDK_READY_TIMEOUT_MS = 60_000;

function out(result) {
    console.log(JSON.stringify(result));
}

function withTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`${label} timeout (${ms}ms)`)), ms),
        ),
    ]);
}

function isEmail(value) {
    return typeof value === 'string' && value.includes('@');
}

const sendMessageProgram = new Command();
sendMessageProgram
    .option('-t, --to <to>', 'Room ID or person email (recipient)')
    .option('-m, --message <message>', 'Markdown body of the message');

async function readStdin() {
    const rl = createInterface({ input: process.stdin, terminal: false });
    const lines = [];
    for await (const line of rl) lines.push(line);
    return lines.join('\n').trim();
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

    await withTimeout(
        new Promise((resolve, reject) => {
            webex.once('ready', resolve);
            webex.once('error', reject);
        }),
        SDK_READY_TIMEOUT_MS,
        'SDK ready',
    );
    if (!webex.canAuthorize) throw new Error('SDK not authorized');
    return webex;
}

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
    if (!markdown && !process.stdin.isTTY) {
        markdown = await readStdin();
    }
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
