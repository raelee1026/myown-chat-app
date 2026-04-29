import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_DIR = join(__dirname, 'public');
const ENV_PATH = join(__dirname, '.env');

loadEnvFile(ENV_PATH);

const PORT = Number(process.env.PORT || 3000);
const MAX_BODY_SIZE = Number(process.env.MAX_BODY_SIZE || 18_000_000);
const DEFAULT_TIME_ZONE = process.env.DEFAULT_TIME_ZONE || 'Asia/Taipei';
const MAX_TOOL_LOOPS = Number(process.env.MAX_TOOL_LOOPS || 3);

function splitList(value, fallback = []) {
  if (!value) return fallback;
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function firstMatchingModel(models, patterns, fallback) {
  const normalizedPatterns = patterns.map((pattern) => String(pattern).toLowerCase());
  return (
    models.find((model) =>
      normalizedPatterns.some((pattern) => String(model).toLowerCase().includes(pattern))
    ) || fallback
  );
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
  const openaiModels = splitList(process.env.OPENAI_MODELS, [
    'gpt-4o-mini',
    'gpt-4o',
    'gpt-4.1-mini',
    'gpt-4.1',
  ]);
  const clubModels = splitList(process.env.CLUB_MODELS, ['qwen35-397b', 'qwen35-4b']);

  const openaiFast = process.env.OPENAI_FAST_MODEL || openaiModels[0] || 'gpt-4o-mini';
  const openaiBalanced = process.env.OPENAI_BALANCED_MODEL || openaiModels[1] || openaiFast;
  const openaiReasoning =
    process.env.OPENAI_REASONING_MODEL ||
    firstMatchingModel(openaiModels, ['4.1', 'o3', 'reason', 'gpt-4o'], openaiBalanced);
  const openaiVision =
    process.env.OPENAI_VISION_MODEL ||
    openaiModels.find((model) => String(model).toLowerCase() === 'gpt-4o') ||
    firstMatchingModel(openaiModels, ['vision', '4o'], openaiBalanced);
  const openaiTool = process.env.OPENAI_TOOL_MODEL || openaiFast;
  const openaiImage = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';

  const clubFast = process.env.CLUB_FAST_MODEL || clubModels[1] || clubModels[0] || '';
  const clubBalanced = process.env.CLUB_BALANCED_MODEL || clubModels[0] || clubFast;
  const clubReasoning =
    process.env.CLUB_REASONING_MODEL ||
    firstMatchingModel(clubModels, ['397b', 'reason', 'qwen35'], clubBalanced);
  const clubVision = process.env.CLUB_VISION_MODEL || clubBalanced;
  const clubTool = process.env.CLUB_TOOL_MODEL || clubFast || clubBalanced;
  const clubImage = process.env.CLUB_IMAGE_MODEL || '';

  return {
    openai: {
      id: 'openai',
      name: 'OpenAI',
      baseUrl: process.env.OPENAI_BASE_URL || '',
      apiKey: process.env.OPENAI_API_KEY || '',
      requiresKey: true,
      models: openaiModels,
      routes: {
        fast: openaiFast,
        balanced: openaiBalanced,
        reasoning: openaiReasoning,
        vision: openaiVision,
        tool: openaiTool,
        image: openaiImage,
      },
      capabilities: {
        text: true,
        vision: true,
        tools: true,
        mcp: true,
        imageGeneration: true,
      },
    },
    club: {
      id: 'club',
      name: 'NYCU Club',
      baseUrl: process.env.CLUB_BASE_URL || '',
      apiKey: process.env.CLUB_API_KEY || '',
      requiresKey: false,
      models: clubModels,
      routes: {
        fast: clubFast,
        balanced: clubBalanced,
        reasoning: clubReasoning,
        vision: clubVision,
        tool: clubTool,
        image: clubImage,
      },
      capabilities: {
        text: true,
        vision: String(process.env.CLUB_SUPPORTS_VISION || '').toLowerCase() === 'true',
        tools: true,
        mcp: true,
        imageGeneration: String(process.env.CLUB_SUPPORTS_IMAGE_GENERATION || '').toLowerCase() === 'true',
      },
    },
  };
}

function publicProviders(providers) {
  return Object.values(providers).map((provider) => ({
    id: provider.id,
    name: provider.name,
    models: provider.models,
    requiresKey: provider.requiresKey,
    hasServerKey: Boolean(String(provider.apiKey || '').trim()),
    routes: provider.routes,
    capabilities: provider.capabilities,
  }));
}

function headerJson(value) {
  return encodeURIComponent(JSON.stringify(value));
}

function sendJson(res, statusCode, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

function sendText(res, statusCode, text, contentType = 'text/plain; charset=utf-8', extraHeaders = {}) {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(text),
    ...extraHeaders,
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

async function serveStatic(_req, res, pathname) {
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
        reject(new Error('Request body too large. Reduce attached image/file size.'));
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

function buildImageUrl(baseUrl) {
  return `${String(baseUrl || '').replace(/\/$/, '')}/images/generations`;
}

function getRequestText(messages = []) {
  return messages
    .map((message) => contentToText(message?.content))
    .join('\n')
    .trim();
}

function getLatestUserText(messages = []) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      return contentToText(messages[index].content);
    }
  }
  return '';
}

function getLatestUserMessage(messages = []) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      return messages[index];
    }
  }
  return null;
}

function contentToText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part?.type === 'text') return part.text || '';
      if (part?.type === 'image_url') return '[image]';
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function hasImageContent(messages = []) {
  return messages.some((message) =>
    Array.isArray(message?.content)
      ? message.content.some((part) => part?.type === 'image_url')
      : false
  );
}

function messageHasImageContent(message) {
  return Array.isArray(message?.content)
    ? message.content.some((part) => part?.type === 'image_url')
    : false;
}

function decideRoute({ messages, routing = {}, toolsEnabled = false, mcpEnabled = false }) {
  const latestUserMessage = getLatestUserMessage(messages);
  const latestText = getLatestUserText(messages).toLowerCase();
  const allText = getRequestText(messages).toLowerCase();
  const looksToolLike =
    /\b(calculate|calculator|compute|math|time now|current time|convert|statistics|word count|tool|mcp)\b/.test(
      latestText
    ) || /計算|現在幾點|時間|換算|統計|工具|函式|函數/.test(latestText);
  const requestedFallback = ['fast', 'balanced', 'reasoning', 'vision', 'tool'].includes(
    routing.profile
  )
    ? routing.profile
    : 'balanced';

  if (messageHasImageContent(latestUserMessage)) {
    return {
      route: 'vision',
      reason: 'image or visual attachment detected',
    };
  }

  if (mcpEnabled && looksToolLike) {
    return {
      route: 'tool',
      reason: 'MCP-enabled tool request',
    };
  }

  if (toolsEnabled && looksToolLike) {
    return {
      route: 'tool',
      reason: 'query looks like a tool-friendly request',
    };
  }

  if (looksToolLike) {
    return {
      route: 'tool',
      reason: 'query looks like a tool-friendly request',
    };
  }

  if (
    /\b(reason|analyze|debug|prove|derive|plan|architecture|compare|trade[- ]?off|complex|step by step|code review)\b/.test(
      allText
    ) ||
    /分析|推理|證明|除錯|架構|比較|規劃|詳細/.test(allText) ||
    allText.length > 1600
  ) {
    return {
      route: 'reasoning',
      reason: 'query appears to need deeper reasoning or longer context',
    };
  }

  if (latestText.length > 0 && latestText.length < 220) {
    return {
      route: 'fast',
      reason: 'short text-only request',
    };
  }

  return {
    route: requestedFallback,
    reason: `fallback profile: ${requestedFallback}`,
  };
}

function resolveRoute({ providerId, model, providers, routing = {}, messages, toolsEnabled, mcpEnabled }) {
  const provider = providers[providerId] || Object.values(providers)[0];
  const mode = routing?.mode === 'auto' ? 'auto' : 'manual';
  const requestedModel = String(model || '').trim();

  if (!provider) {
    return {
      provider: null,
      model: requestedModel,
      decision: {
        mode,
        route: 'manual',
        reason: 'No provider configured',
        model: requestedModel,
        providerId,
      },
    };
  }

  if (mode !== 'auto') {
    const selectedModel = requestedModel || provider.models?.[0] || '';
    return {
      provider,
      model: selectedModel,
      decision: {
        mode,
        route: 'manual',
        reason: 'manual provider/model selected',
        providerId: provider.id,
        providerName: provider.name,
        model: selectedModel,
        requestedModel,
        capabilities: provider.capabilities,
      },
    };
  }

  const routeInfo = decideRoute({ messages, routing, toolsEnabled, mcpEnabled });
  const selectedModel =
    provider.routes?.[routeInfo.route] ||
    provider.routes?.balanced ||
    requestedModel ||
    provider.models?.[0] ||
    '';

  return {
    provider,
    model: selectedModel,
    decision: {
      mode,
      route: routeInfo.route,
      reason: routeInfo.reason,
      providerId: provider.id,
      providerName: provider.name,
      model: selectedModel,
      requestedModel,
      requestedProviderId: providerId,
      capabilities: provider.capabilities,
      hasImages: hasImageContent(messages),
      toolsEnabled: Boolean(toolsEnabled),
      mcpEnabled: Boolean(mcpEnabled),
    },
  };
}

function resolveApiKey(provider, providerId, apiKey, apiKeys) {
  const directKey = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (directKey) return directKey;

  if (apiKeys && typeof apiKeys === 'object') {
    const keyed = apiKeys[providerId];
    if (typeof keyed === 'string' && keyed.trim()) return keyed.trim();
  }

  return String(provider?.apiKey || '').trim();
}

const MCP_TOOL_SPECS = [
  {
    name: 'calculator',
    description: 'Safely evaluate a math expression. Supports Math functions such as sin, cos, sqrt, pow, log, round, PI, and E.',
    inputSchema: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: 'The mathematical expression to evaluate, for example "sqrt(144) + 7 * 3".',
        },
      },
      required: ['expression'],
    },
  },
  {
    name: 'get_current_time',
    description: 'Return the current time for a requested IANA time zone.',
    inputSchema: {
      type: 'object',
      properties: {
        timezone: {
          type: 'string',
          description: 'IANA timezone, for example Asia/Taipei or America/Los_Angeles.',
        },
      },
    },
  },
  {
    name: 'text_stats',
    description: 'Count characters, words, lines, and estimated reading time for a piece of text.',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to analyze.',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'memory_search',
    description: 'Search the user long-term memory bank supplied by the browser app.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query for memory lookup.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'unit_convert',
    description: 'Convert common units for temperature, length, weight, and data size.',
    inputSchema: {
      type: 'object',
      properties: {
        value: { type: 'number', description: 'Numeric value to convert.' },
        from: { type: 'string', description: 'Source unit, e.g. c, f, km, mile, kg, lb, mb, gb.' },
        to: { type: 'string', description: 'Target unit, e.g. c, f, km, mile, kg, lb, mb, gb.' },
      },
      required: ['value', 'from', 'to'],
    },
  },
];

function openAIToolDefinitions() {
  return MCP_TOOL_SPECS.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));
}

function publicToolList() {
  return MCP_TOOL_SPECS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
}

function safeMath(expression) {
  const raw = String(expression || '').trim();
  if (!raw) throw new Error('Expression is required.');
  if (raw.length > 300) throw new Error('Expression is too long.');
  if (!/^[0-9A-Za-z_+\-*/%^().,\s]+$/.test(raw)) {
    throw new Error('Expression contains unsupported characters.');
  }

  const allowedIdentifiers = new Set([
    ...Object.getOwnPropertyNames(Math),
    'PI',
    'E',
    'LN2',
    'LN10',
    'LOG2E',
    'LOG10E',
    'SQRT1_2',
    'SQRT2',
  ]);
  const identifiers = raw.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];
  for (const identifier of identifiers) {
    if (!allowedIdentifiers.has(identifier)) {
      throw new Error(`Unsupported identifier: ${identifier}`);
    }
  }

  const expressionForJs = raw.replace(/\^/g, '**');
  const mathNames = Object.getOwnPropertyNames(Math).filter((name) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name));
  const args = mathNames;
  const values = mathNames.map((name) => Math[name]);
  // The expression has already been constrained to numbers, math identifiers, and operators.
  const fn = new Function(...args, `'use strict'; return (${expressionForJs});`);
  const value = fn(...values);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('Expression did not produce a finite number.');
  }
  return value;
}

function normalizeUnit(unit) {
  return String(unit || '').trim().toLowerCase().replace(/s$/, '');
}

function convertUnit(value, from, to) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw new Error('value must be a finite number.');

  const source = normalizeUnit(from);
  const target = normalizeUnit(to);

  const aliases = {
    celsius: 'c',
    fahrenheit: 'f',
    kelvin: 'k',
    kilometer: 'km',
    kilometre: 'km',
    meter: 'm',
    metre: 'm',
    centimeter: 'cm',
    centimetre: 'cm',
    mile: 'mi',
    inch: 'in',
    foot: 'ft',
    feet: 'ft',
    kilogram: 'kg',
    gram: 'g',
    pound: 'lb',
    megabyte: 'mb',
    gigabyte: 'gb',
  };

  const s = aliases[source] || source;
  const t = aliases[target] || target;

  if (['c', 'f', 'k'].includes(s) && ['c', 'f', 'k'].includes(t)) {
    let celsius;
    if (s === 'c') celsius = amount;
    if (s === 'f') celsius = (amount - 32) * (5 / 9);
    if (s === 'k') celsius = amount - 273.15;

    if (t === 'c') return celsius;
    if (t === 'f') return celsius * (9 / 5) + 32;
    if (t === 'k') return celsius + 273.15;
  }

  const lengthToMeter = { km: 1000, m: 1, cm: 0.01, mm: 0.001, mi: 1609.344, ft: 0.3048, in: 0.0254 };
  if (s in lengthToMeter && t in lengthToMeter) {
    return (amount * lengthToMeter[s]) / lengthToMeter[t];
  }

  const weightToGram = { kg: 1000, g: 1, mg: 0.001, lb: 453.59237, oz: 28.349523125 };
  if (s in weightToGram && t in weightToGram) {
    return (amount * weightToGram[s]) / weightToGram[t];
  }

  const dataToByte = { b: 1, kb: 1000, mb: 1_000_000, gb: 1_000_000_000, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3 };
  if (s in dataToByte && t in dataToByte) {
    return (amount * dataToByte[s]) / dataToByte[t];
  }

  throw new Error(`Unsupported conversion: ${from} to ${to}`);
}

function scoreMemory(query, memory) {
  const q = String(query || '').toLowerCase();
  const text = String(memory?.text || memory || '').toLowerCase();
  if (!q) return 1;
  let score = 0;
  for (const token of q.split(/[\s,.;:!?，。！？、]+/).filter(Boolean)) {
    if (token.length < 2) continue;
    if (text.includes(token)) score += token.length;
  }
  return score;
}

async function executeTool(name, args = {}, context = {}) {
  const startedAt = Date.now();
  let result;

  if (name === 'calculator') {
    const value = safeMath(args.expression);
    result = {
      expression: String(args.expression || '').trim(),
      result: value,
    };
  } else if (name === 'get_current_time') {
    const timezone = String(args.timezone || DEFAULT_TIME_ZONE).trim() || DEFAULT_TIME_ZONE;
    const now = new Date();
    const formatted = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZoneName: 'short',
    }).format(now);
    result = {
      timezone,
      iso: now.toISOString(),
      formatted,
    };
  } else if (name === 'text_stats') {
    const text = String(args.text || '');
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const characters = [...text].length;
    const lines = text ? text.split(/\r?\n/).length : 0;
    result = {
      characters,
      words,
      lines,
      estimatedReadingMinutes: words ? Number((words / 220).toFixed(2)) : 0,
    };
  } else if (name === 'memory_search') {
    const memories = Array.isArray(context.memories) ? context.memories : [];
    const matches = memories
      .map((memory) => ({
        id: memory?.id,
        text: String(memory?.text || '').slice(0, 600),
        tags: Array.isArray(memory?.tags) ? memory.tags : [],
        score: scoreMemory(args.query, memory),
      }))
      .filter((memory) => memory.text && memory.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
    result = {
      query: String(args.query || ''),
      count: matches.length,
      matches,
    };
  } else if (name === 'unit_convert') {
    const converted = convertUnit(args.value, args.from, args.to);
    result = {
      value: Number(args.value),
      from: args.from,
      to: args.to,
      result: Number(converted.toFixed(8)),
    };
  } else {
    throw new Error(`Unknown tool: ${name}`);
  }

  return {
    tool: name,
    ok: true,
    elapsedMs: Date.now() - startedAt,
    result,
  };
}

async function safeExecuteTool(name, args, context) {
  try {
    return await executeTool(name, args, context);
  } catch (error) {
    return {
      tool: name,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function handleProviders(_req, res) {
  const providers = getProviders();
  sendJson(res, 200, { providers: publicProviders(providers) });
}

async function handleTools(_req, res) {
  sendJson(res, 200, {
    tools: publicToolList(),
    mcp: {
      manifest: '/mcp/manifest',
      jsonRpc: '/mcp',
      methods: ['initialize', 'tools/list', 'tools/call'],
    },
  });
}

async function handleToolCall(req, res) {
  let parsedBody;
  try {
    const rawBody = await readRequestBody(req);
    parsedBody = rawBody ? JSON.parse(rawBody) : {};
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : 'Invalid JSON body' });
    return;
  }

  const result = await safeExecuteTool(parsedBody.name, parsedBody.arguments || parsedBody.args || {}, {
    memories: Array.isArray(parsedBody.memories) ? parsedBody.memories : [],
  });
  sendJson(res, result.ok ? 200 : 400, result);
}

async function handleMcpManifest(_req, res) {
  sendJson(res, 200, {
    name: 'hw2-local-mcp',
    version: '2.0.0',
    description: 'Local MCP-style endpoint for HW2 demo: list/call tools used by the chat app.',
    protocol: 'json-rpc-2.0',
    endpoint: '/mcp',
    capabilities: {
      tools: true,
      resources: false,
      prompts: false,
    },
    tools: publicToolList(),
  });
}

async function handleMcp(req, res) {
  let rpc;
  try {
    const rawBody = await readRequestBody(req);
    rpc = rawBody ? JSON.parse(rawBody) : {};
  } catch (error) {
    sendJson(res, 400, {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: error instanceof Error ? error.message : 'Parse error' },
    });
    return;
  }

  const id = rpc?.id ?? null;
  const method = String(rpc?.method || '');

  try {
    if (method === 'initialize') {
      sendJson(res, 200, {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'hw2-local-mcp', version: '2.0.0' },
        },
      });
      return;
    }

    if (method === 'tools/list') {
      sendJson(res, 200, {
        jsonrpc: '2.0',
        id,
        result: { tools: publicToolList() },
      });
      return;
    }

    if (method === 'tools/call') {
      const params = rpc.params || {};
      const result = await safeExecuteTool(params.name, params.arguments || {}, {
        memories: Array.isArray(params.memories) ? params.memories : [],
      });
      sendJson(res, 200, {
        jsonrpc: '2.0',
        id,
        result: {
          isError: !result.ok,
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        },
      });
      return;
    }

    sendJson(res, 404, {
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Unknown MCP method: ${method}` },
    });
  } catch (error) {
    sendJson(res, 500, {
      jsonrpc: '2.0',
      id,
      error: { code: -32000, message: error instanceof Error ? error.message : 'Tool error' },
    });
  }
}

async function handleHealth(_req, res) {
  sendJson(res, 200, {
    ok: true,
    service: 'nebula-chat-hw2',
    time: new Date().toISOString(),
    features: ['long-term-memory', 'multimodal', 'auto-routing', 'tool-use', 'mcp'],
  });
}

function parseToolArguments(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return { raw: String(raw) };
  }
}

async function fetchUpstream(provider, apiKey, payload, signal) {
  const headers = {
    'Content-Type': 'application/json',
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  return fetch(buildChatUrl(provider.baseUrl), {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal,
  });
}

async function fetchImageUpstream(provider, apiKey, payload, signal) {
  const headers = {
    'Content-Type': 'application/json',
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  return fetch(buildImageUrl(provider.baseUrl), {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal,
  });
}

async function parseUpstreamJson(upstreamResponse) {
  const bodyText = await upstreamResponse.text();
  if (!upstreamResponse.ok) {
    const error = new Error(bodyText || 'Upstream request failed');
    error.statusCode = upstreamResponse.status;
    error.contentType = upstreamResponse.headers.get('content-type') || 'text/plain; charset=utf-8';
    error.bodyText = bodyText;
    throw error;
  }

  try {
    return bodyText ? JSON.parse(bodyText) : {};
  } catch {
    return {
      choices: [
        {
          message: {
            role: 'assistant',
            content: bodyText,
          },
        },
      ],
    };
  }
}

function sendUpstreamError(res, error, extraHeaders = {}) {
  const statusCode = Number(error?.statusCode || 500);
  const contentType = String(error?.contentType || 'text/plain; charset=utf-8');
  const bodyText = String(error?.bodyText || error?.message || 'Unexpected server error');

  if (contentType.includes('application/json')) {
    try {
      sendJson(res, statusCode, JSON.parse(bodyText), extraHeaders);
      return;
    } catch {
      // Fall through to text.
    }
  }

  sendText(res, statusCode, bodyText, contentType, extraHeaders);
}

function extractAssistantMessage(payload) {
  return payload?.choices?.[0]?.message || null;
}

function extractAssistantText(payload) {
  const message = extractAssistantMessage(payload);
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => (part?.type === 'text' ? part.text || '' : '')).join('');
  }
  return '';
}

function resolveImageModel(provider, requestedModel) {
  const normalized = String(requestedModel || '').trim();
  if (/^(gpt-image|dall-e|chatgpt-image)/i.test(normalized)) {
    return normalized;
  }

  return (
    provider?.routes?.image ||
    provider?.models?.find((model) => /^(gpt-image|dall-e|chatgpt-image)/i.test(String(model))) ||
    normalized
  );
}

function buildImageResponse(data, routeDecision, imageModel) {
  const images = Array.isArray(data?.data)
    ? data.data
        .map((item, index) => {
          const base64 = typeof item?.b64_json === 'string' ? item.b64_json.trim() : '';
          if (!base64) return null;
          return {
            id: item?.id || `generated-image-${index + 1}`,
            kind: 'image',
            mimeType: 'image/png',
            name: `generated-${index + 1}.png`,
            dataUrl: `data:image/png;base64,${base64}`,
            revisedPrompt: item?.revised_prompt || '',
            size: 0,
          };
        })
        .filter(Boolean)
    : [];

  return {
    created: data?.created || Date.now(),
    images,
    output_text:
      data?.data?.[0]?.revised_prompt ||
      (images.length ? `Generated ${images.length} image${images.length > 1 ? 's' : ''}.` : ''),
    route_decision: {
      ...routeDecision,
      model: imageModel,
      route: 'image',
      reason: 'image generation request',
    },
  };
}

async function handleImageGeneration({
  provider,
  apiKey,
  model,
  messages,
  signal,
  routeDecision,
  res,
}) {
  if (!provider?.capabilities?.imageGeneration) {
    sendJson(
      res,
      400,
      {
        error: `${provider?.name || 'This provider'} does not support image generation in this app.`,
        route_decision: routeDecision,
      },
      { 'X-Route-Decision': headerJson(routeDecision) }
    );
    return;
  }

  const prompt = getLatestUserText(messages).trim();
  if (!prompt) {
    sendJson(
      res,
      400,
      {
        error: 'A text prompt is required to generate an image.',
        route_decision: routeDecision,
      },
      { 'X-Route-Decision': headerJson(routeDecision) }
    );
    return;
  }

  const imageModel = resolveImageModel(provider, model);
  if (!imageModel) {
    sendJson(
      res,
      400,
      {
        error: 'No image model is configured. Set OPENAI_IMAGE_MODEL or enter an image model name.',
        route_decision: routeDecision,
      },
      { 'X-Route-Decision': headerJson(routeDecision) }
    );
    return;
  }

  const upstreamPayload = {
    model: imageModel,
    prompt,
    size: '1024x1024',
  };

  const upstreamResponse = await fetchImageUpstream(provider, apiKey, upstreamPayload, signal);
  const data = await parseUpstreamJson(upstreamResponse);
  sendJson(res, 200, buildImageResponse(data, routeDecision, imageModel), {
    'X-Route-Decision': headerJson({
      ...routeDecision,
      model: imageModel,
      route: 'image',
      reason: 'image generation request',
    }),
  });
}

async function handleChatWithTools({
  provider,
  apiKey,
  model,
  messages,
  parameters,
  signal,
  routeDecision,
  res,
  toolContext,
}) {
  const routeHeader = { 'X-Route-Decision': headerJson(routeDecision) };
  const loopMessages = [...messages];
  const toolTrace = [];
  let finalPayload = null;

  for (let step = 0; step < MAX_TOOL_LOOPS; step += 1) {
    const payload = {
      model,
      messages: loopMessages,
      stream: false,
      ...parameters,
      tools: openAIToolDefinitions(),
      tool_choice: 'auto',
    };

    const upstreamResponse = await fetchUpstream(provider, apiKey, payload, signal);
    const data = await parseUpstreamJson(upstreamResponse);
    finalPayload = data;
    const assistantMessage = extractAssistantMessage(data);
    const toolCalls = Array.isArray(assistantMessage?.tool_calls)
      ? assistantMessage.tool_calls
      : [];

    if (!toolCalls.length) {
      data.route_decision = routeDecision;
      data.tool_trace = toolTrace;
      sendJson(res, 200, data, routeHeader);
      return;
    }

    loopMessages.push(assistantMessage);

    for (const call of toolCalls) {
      const toolName = call?.function?.name || call?.name || '';
      const args = parseToolArguments(call?.function?.arguments || call?.arguments);
      const result = await safeExecuteTool(toolName, args, toolContext);
      toolTrace.push({
        name: toolName,
        arguments: args,
        result,
      });
      loopMessages.push({
        role: 'tool',
        tool_call_id: call.id,
        name: toolName,
        content: JSON.stringify(result),
      });
    }
  }

  const finalResponse = await fetchUpstream(
    provider,
    apiKey,
    {
      model,
      messages: loopMessages,
      stream: false,
      ...parameters,
    },
    signal
  );
  const finalData = await parseUpstreamJson(finalResponse);
  finalData.route_decision = routeDecision;
  finalData.tool_trace = toolTrace;
  finalData.tool_loop_limit_reached = Boolean(finalPayload);
  sendJson(res, 200, finalData, routeHeader);
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
    apiKeys,
    stream = true,
    generationMode = 'chat',
    parameters = {},
    routing = {},
    toolsEnabled = false,
    mcpEnabled = false,
    longTermMemories = [],
  } = parsedBody || {};

  const providers = getProviders();
  const routeResolution = resolveRoute({
    providerId,
    model,
    providers,
    routing,
    messages,
    toolsEnabled,
    mcpEnabled,
  });
  const provider = routeResolution.provider;
  const selectedModel = routeResolution.model;
  const routeDecision = routeResolution.decision;
  const routeHeader = { 'X-Route-Decision': headerJson(routeDecision) };

  if (!provider) {
    sendJson(res, 400, { error: 'Unknown provider' }, routeHeader);
    return;
  }

  const effectiveApiKey = resolveApiKey(provider, provider.id, apiKey, apiKeys);

  if (provider.requiresKey && !effectiveApiKey) {
    sendJson(
      res,
      400,
      {
        error: `Provider ${provider.name} requires an API key. Enter it in the UI or .env.`,
        route_decision: routeDecision,
      },
      routeHeader
    );
    return;
  }

  if (!selectedModel || typeof selectedModel !== 'string') {
    sendJson(res, 400, { error: 'Model is required', route_decision: routeDecision }, routeHeader);
    return;
  }

  if (!provider.baseUrl || typeof provider.baseUrl !== 'string') {
    sendJson(
      res,
      400,
      {
        error: `Base URL is not configured for provider: ${provider.name}`,
        route_decision: routeDecision,
      },
      routeHeader
    );
    return;
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    sendJson(res, 400, { error: 'Messages are required', route_decision: routeDecision }, routeHeader);
    return;
  }

  const sanitizedParameters = filterParameters(parameters);
  const controller = new AbortController();
  const abortUpstream = () => {
    if (!controller.signal.aborted) {
      controller.abort();
    }
  };

  req.on('close', abortUpstream);
  res.on('close', abortUpstream);

  try {
    if (generationMode === 'image') {
      await handleImageGeneration({
        provider,
        apiKey: effectiveApiKey,
        model: selectedModel,
        messages,
        signal: controller.signal,
        routeDecision,
        res,
      });
      return;
    }

    if (toolsEnabled || mcpEnabled) {
      await handleChatWithTools({
        provider,
        apiKey: effectiveApiKey,
        model: selectedModel,
        messages,
        parameters: sanitizedParameters,
        signal: controller.signal,
        routeDecision,
        res,
        toolContext: {
          memories: Array.isArray(longTermMemories) ? longTermMemories : [],
        },
      });
      return;
    }

    const upstreamPayload = {
      model: selectedModel,
      messages,
      stream: Boolean(stream),
      ...sanitizedParameters,
    };

    const upstreamResponse = await fetchUpstream(
      provider,
      effectiveApiKey,
      upstreamPayload,
      controller.signal
    );

    if (!upstreamResponse.ok) {
      const contentType = upstreamResponse.headers.get('content-type') || '';
      const bodyText = await upstreamResponse.text();
      if (contentType.includes('application/json')) {
        try {
          const parsed = JSON.parse(bodyText);
          parsed.route_decision = routeDecision;
          sendJson(res, upstreamResponse.status, parsed, routeHeader);
          return;
        } catch {
          // Ignore JSON parse error and fall through to text response.
        }
      }

      sendText(
        res,
        upstreamResponse.status,
        bodyText || 'Upstream request failed',
        contentType || 'text/plain; charset=utf-8',
        routeHeader
      );
      return;
    }

    if (!stream) {
      const contentType = upstreamResponse.headers.get('content-type') || '';
      const bodyText = await upstreamResponse.text();

      if (contentType.includes('application/json')) {
        try {
          const parsed = JSON.parse(bodyText);
          parsed.route_decision = routeDecision;
          sendJson(res, 200, parsed, routeHeader);
          return;
        } catch {
          // Continue to raw response when JSON parse fails.
        }
      }

      sendText(res, 200, bodyText, contentType || 'text/plain; charset=utf-8', routeHeader);
      return;
    }

    const contentType =
      upstreamResponse.headers.get('content-type') || 'text/event-stream; charset=utf-8';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...routeHeader,
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

    sendUpstreamError(res, error, routeHeader);
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

    if (req.method === 'GET' && pathname === '/api/tools') {
      await handleTools(req, res);
      return;
    }

    if (req.method === 'POST' && pathname === '/api/tools/call') {
      await handleToolCall(req, res);
      return;
    }

    if (req.method === 'GET' && pathname === '/mcp/manifest') {
      await handleMcpManifest(req, res);
      return;
    }

    if (req.method === 'POST' && pathname === '/mcp') {
      await handleMcp(req, res);
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
  console.log(`HW2 chat is running on port ${PORT}`);
});
