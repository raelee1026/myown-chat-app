import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_DIR = join(__dirname, 'public');
const ENV_PATH = join(__dirname, '.env');

loadEnvFile(ENV_PATH);

const PORT = Number(process.env.PORT || 3000);
const MAX_BODY_SIZE = Number(process.env.MAX_BODY_SIZE || 2_000_000);

function splitList(value, fallback = []) {
  if (!value) return fallback;
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;

  const content = readFileSync(filePath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index === -1) continue;

    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function getProviders() {
  return {
    openai: {
      id: 'openai',
      name: 'OpenAI',
      baseUrl: process.env.OPENAI_BASE_URL || '',
      requiresKey: true,
      models: splitList(process.env.OPENAI_MODELS, [
        'gpt-4o-mini',
        'gpt-4o',
        'gpt-4.1-mini',
        'gpt-4.1',
      ]),
    },
    club: {
      id: 'club',
      name: 'NYCU Club',
      baseUrl: process.env.CLUB_BASE_URL || '',
      requiresKey: false,
      models: splitList(process.env.CLUB_MODELS, ['qwen35-397b', 'qwen35-4b']),
    },
  };
}

function publicProviders(providers) {
  return Object.values(providers).map((provider) => ({
    id: provider.id,
    name: provider.name,
    models: provider.models,
    requiresKey: provider.requiresKey,
  }));
}

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendText(res, statusCode, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(text),
  });
  res.end(text);
}

function getContentType(filePath) {
  const ext = extname(filePath).toLowerCase();
  const map = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
  };
  return map[ext] || 'application/octet-stream';
}

async function serveStatic(req, res, pathname) {
  let safePath = pathname === '/' ? '/index.html' : pathname;
  safePath = normalize(decodeURIComponent(safePath)).replace(/^(\.\.[/\\])+/, '');

  let filePath = join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }

  try {
    const info = await stat(filePath);
    if (info.isDirectory()) {
      filePath = join(filePath, 'index.html');
    }

    const fileInfo = await stat(filePath);
    res.writeHead(200, {
      'Content-Type': getContentType(filePath),
      'Content-Length': fileInfo.size,
      'Cache-Control': 'no-cache',
    });

    createReadStream(filePath).pipe(res);
  } catch {
    sendJson(res, 404, { error: 'Not found' });
  }
}

async function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];

    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_SIZE) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });

    req.on('error', reject);
  });
}

function filterParameters(parameters = {}) {
  const allowedKeys = [
    'temperature',
    'top_p',
    'max_tokens',
    'presence_penalty',
    'frequency_penalty',
  ];

  const filtered = {};
  for (const key of allowedKeys) {
    const value = parameters[key];
    if (value === '' || value === null || value === undefined || Number.isNaN(value)) {
      continue;
    }
    filtered[key] = value;
  }

  return filtered;
}

function buildChatUrl(baseUrl) {
  return `${String(baseUrl || '').replace(/\/$/, '')}/chat/completions`;
}

async function handleProviders(_req, res) {
  const providers = getProviders();
  sendJson(res, 200, { providers: publicProviders(providers) });
}

async function handleHealth(_req, res) {
  sendJson(res, 200, {
    ok: true,
    service: 'nebula-chat',
    time: new Date().toISOString(),
  });
}

async function handleChat(req, res) {
  let parsedBody;

  try {
    const rawBody = await readRequestBody(req);
    parsedBody = rawBody ? JSON.parse(rawBody) : {};
  } catch (error) {
    sendJson(res, 400, {
      error: error instanceof Error ? error.message : 'Invalid JSON body',
    });
    return;
  }

  const {
    providerId,
    model,
    messages,
    apiKey,
    stream = true,
    parameters = {},
  } = parsedBody || {};

  const providers = getProviders();
  const provider = providers[providerId];

  if (!provider) {
    sendJson(res, 400, { error: 'Unknown provider' });
    return;
  }

  const effectiveApiKey = typeof apiKey === 'string' ? apiKey.trim() : '';

  if (provider.requiresKey && !effectiveApiKey) {
    sendJson(res, 400, {
      error: 'This provider requires an API key. Please provide it in the UI.',
    });
    return;
  }

  if (!model || typeof model !== 'string') {
    sendJson(res, 400, { error: 'Model is required' });
    return;
  }

  if (!provider.baseUrl || typeof provider.baseUrl !== 'string') {
    sendJson(res, 400, {
      error: `Base URL is not configured for provider: ${provider.name}`,
    });
    return;
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    sendJson(res, 400, { error: 'Messages are required' });
    return;
  }

  const upstreamPayload = {
    model,
    messages,
    stream: Boolean(stream),
    ...filterParameters(parameters),
  };

  const headers = {
    'Content-Type': 'application/json',
  };

  if (effectiveApiKey) {
    headers.Authorization = `Bearer ${effectiveApiKey}`;
  }

  const controller = new AbortController();
  const abortUpstream = () => {
    if (!controller.signal.aborted) {
      controller.abort();
    }
  };

  req.on('close', abortUpstream);
  res.on('close', abortUpstream);

  try {
    const upstreamResponse = await fetch(buildChatUrl(provider.baseUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify(upstreamPayload),
      signal: controller.signal,
    });

    if (!upstreamResponse.ok) {
      const contentType = upstreamResponse.headers.get('content-type') || '';
      const bodyText = await upstreamResponse.text();
      if (contentType.includes('application/json')) {
        try {
          const parsed = JSON.parse(bodyText);
          sendJson(res, upstreamResponse.status, parsed);
          return;
        } catch {
          // Ignore JSON parse error and fall through to text response.
        }
      }

      sendText(
        res,
        upstreamResponse.status,
        bodyText || 'Upstream request failed',
        contentType || 'text/plain; charset=utf-8'
      );
      return;
    }

    if (!stream) {
      const contentType = upstreamResponse.headers.get('content-type') || '';
      const bodyText = await upstreamResponse.text();

      if (contentType.includes('application/json')) {
        try {
          const parsed = JSON.parse(bodyText);
          sendJson(res, 200, parsed);
          return;
        } catch {
          // Continue to raw response when JSON parse fails.
        }
      }

      sendText(res, 200, bodyText, contentType || 'text/plain; charset=utf-8');
      return;
    }

    const contentType =
      upstreamResponse.headers.get('content-type') || 'text/event-stream; charset=utf-8';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    if (!upstreamResponse.body) {
      res.end();
      return;
    }

    const upstreamStream = Readable.fromWeb(upstreamResponse.body);
    upstreamStream.on('error', () => {
      if (!res.writableEnded) {
        res.end();
      }
    });

    upstreamStream.pipe(res);
  } catch (error) {
    if (controller.signal.aborted) {
      if (!res.writableEnded) {
        res.end();
      }
      return;
    }

    sendJson(res, 500, {
      error: error instanceof Error ? error.message : 'Unexpected server error',
    });
  }
}

const server = createServer(async (req, res) => {
  try {
    if (!req.url) {
      sendJson(res, 400, { error: 'Missing request URL' });
      return;
    }

    const pathname = String(req.url).split('?')[0] || '/';

    if (req.method === 'GET' && pathname === '/api/providers') {
      await handleProviders(req, res);
      return;
    }

    if (req.method === 'GET' && pathname === '/api/health') {
      await handleHealth(req, res);
      return;
    }

    if (req.method === 'POST' && pathname === '/api/chat') {
      await handleChat(req, res);
      return;
    }

    if (req.method === 'GET') {
      await serveStatic(req, res, pathname);
      return;
    }

    sendJson(res, 405, { error: 'Method not allowed' });
  } catch (error) {
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : 'Unexpected server error',
    });
  }
});

server.listen(PORT, () => {
  console.log(`Chat is running on port ${PORT}`);
});
