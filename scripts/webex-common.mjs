/**
 * Shared utilities for Webex scripts: env loading, SDK init, stdout JSON, timeout.
 */
import { consola } from 'consola';
import WebexNode from 'webex-node';
import dotenv from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SDK_READY_TIMEOUT_MS = 60_000;

/**
 * Resolve script paths and load .env from project root. Call with import.meta.url from the script.
 * @param {string} importMetaUrl - import.meta.url from the calling script
 * @returns {{ SCRIPT_DIR: string, PROJECT_ROOT: string, ENV_PATH: string }}
 */
export function loadEnv(importMetaUrl) {
    const SCRIPT_DIR = dirname(fileURLToPath(importMetaUrl));
    const PROJECT_ROOT = resolve(SCRIPT_DIR, '..');
    const ENV_PATH = resolve(PROJECT_ROOT, '.env');
    dotenv.config({ path: ENV_PATH, quiet: true });
    return { SCRIPT_DIR, PROJECT_ROOT, ENV_PATH };
}

export function setupConsola() {
    consola.options.stdout = process.stderr;
    consola.options.stderr = process.stderr;
}

/** Print a single JSON line to stdout (for agent consumption). */
export function out(result) {
    console.log(JSON.stringify(result));
}

export function withTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`${label} timeout (${ms}ms)`)), ms),
        ),
    ]);
}

/**
 * Initialize Webex SDK with access token. Requires WEBEX_ACCESS_TOKEN or pass token.
 * @param {string} accessToken
 * @returns {Promise<import('webex-node').Webex>}
 */
export async function initWebex(accessToken) {
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

export { consola };
