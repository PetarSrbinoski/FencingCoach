// Run the current UI against the API configured in the repository's .env.
// No backend, database, workers or production frontend are restarted.
const path = require('node:path');
const http = require('node:http');
const { loadEnvConfig } = require('@next/env');
const next = require('next');

const frontend = path.resolve(__dirname, '..');
loadEnvConfig(path.resolve(frontend, '..'));
const upstream = process.env.COACH_PREVIEW_API_URL || process.env.NEXT_PUBLIC_API_BASE_URL;
if (!upstream || !/^https?:$/.test(new URL(upstream).protocol)) {
  throw new Error('Set NEXT_PUBLIC_API_BASE_URL to your reachable backend in the repository .env');
}
process.env.COACH_PREVIEW_API_URL = upstream;
process.chdir(frontend);
const app = next({ dev: true, dir: frontend });
app.prepare().then(() => {
  http.createServer(app.getRequestHandler()).listen(13000, '0.0.0.0', () => {
    console.log('Coach preview: http://localhost:13000 (same-origin API proxy enabled)');
  });
}).catch((error) => { console.error(error); process.exitCode = 1; });
