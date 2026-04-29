# HW2 MyOwn Chat

An OpenAI-compatible multi-provider chat playground for HW2, built with a native Node.js HTTP server, HTML, CSS, and vanilla JavaScript.

This project extends a normal chat UI into a complete LLM demo system with:

- long-term memory
- multimodal input
- automatic model routing
- local tool use
- MCP-style tool endpoints
- conversation branching, summary, export, theme switching, and local persistence

The system supports both **OpenAI** and **any self-hosted / third-party provider** that exposes an OpenAI-compatible `/chat/completions` API, including self-hosted Qwen-based servers.

---

## Features

### 1. Long-term Memory

- Sidebar panel for long-term memory management
- Manual add / search / delete / clear
- Auto-save of obvious preferences from user messages
- `Remember` button on assistant messages to save useful outputs
- Memory persisted in browser `localStorage`
- Relevant memories injected into system context before sending requests
- `Long-term memory used` section under assistant replies to show which memories were actually used
- No hard upper limit on stored memories
- `Relevant memory limit` can be left blank to mean “no limit”

### 2. Multimodal Input

- `Attach` button in composer
- Supports image files with OpenAI-compatible `image_url` content parts
- Supports text-like files such as:
  - `.txt`
  - `.md`
  - `.csv`
  - `.json`
  - `.js`
  - `.ts`
  - `.py`
  - `.html`
  - `.css`
  - `.xml`
  - `.yaml`
  - `.yml`
- Attachment preview before sending
- Attachment rendering inside chat history

### 3. Auto Routing Between Models

- Manual or auto routing mode
- Route types:
  - `fast`
  - `reasoning`
  - `vision`
  - `tool`
  - fallback profile
- Frontend gives immediate route feedback
- Backend performs final authoritative route decision
- Route pill shown below assistant replies
- Route maps are configurable per provider through `.env`

### 4. Tool Use

Built-in server-side local tools:

- `calculator`
- `get_current_time`
- `text_stats`
- `unit_convert`
- `memory_search`

When tools are enabled, the server runs a tool loop:

1. model requests a tool
2. server executes it locally
3. result is injected back into the conversation
4. model produces final answer

Tool traces are visible in the UI under `Tools used`.

### 5. MCP

The project exposes a local MCP-style JSON-RPC interface for demo and testing:

- `GET /mcp/manifest`
- `POST /mcp`

Supported JSON-RPC methods:

- `initialize`
- `tools/list`
- `tools/call`

This allows the same local capability layer to be demonstrated both inside the chat UI and through a structured protocol interface.

### 6. Other Useful Functions

- multi-conversation management
- branch from any message
- summary card generation
- chat export
- theme switcher
- voice input support through browser speech recognition
- browser-side persistence of settings, conversations, and memories
- hidden auto demo runner for presentation use

---

## Architecture

### Frontend

Files:

- `public/index.html`
- `public/styles.css`
- `public/app.js`
- `public/auto-demo.js`

Responsibilities:

- render UI
- manage local state
- persist settings / conversations / memories in `localStorage`
- build request payloads
- convert images into `image_url` content parts
- select relevant long-term memories
- display route, memory, and tool traces

### Backend

File:

- `server.js`

Responsibilities:

- serve static frontend files
- expose `/api/providers`, `/api/tools`, `/api/chat`
- expose `/mcp/manifest` and `/mcp`
- resolve provider + model from `.env`
- choose route in auto mode
- execute local tool loop
- forward requests to upstream OpenAI-compatible providers

### Data Flow

1. User interacts with frontend UI.
2. Frontend builds a request using:
   - short-term chat history
   - system prompt
   - relevant long-term memories
   - attachments
   - routing / tool settings
3. Frontend sends request to `/api/chat`.
4. Backend resolves provider, route, and target model.
5. Backend optionally runs local tool loop.
6. Backend forwards request to upstream provider.
7. Frontend renders answer plus route / memory / tool metadata.

---

## Project Structure

```text
hw2/
├─ public/
│  ├─ index.html
│  ├─ styles.css
│  ├─ app.js
│  └─ auto-demo.js
├─ .env.example
├─ .gitignore
├─ demo-script.md
├─ package.json
├─ README.md
├─ report.md
└─ server.js
```

---

## Requirements

- Node.js 18+ recommended
- one or more OpenAI-compatible `/chat/completions` providers
- browser with modern JavaScript support

For best experience:

- Chrome / Edge for voice input demo
- a provider with tool calling support
- a provider with vision support if you want image routing demos

---

## Quick Start

### 1. Copy environment file

```bash
cp .env.example .env
```

### 2. Fill provider settings

Edit `.env` and set at least one working provider.

Example:

```env
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=your_key_here
```

Or use your own self-hosted OpenAI-compatible server:

```env
CLUB_BASE_URL=http://your-server:port/v1
CLUB_API_KEY=
CLUB_MODELS=qwen35-397b,qwen35-4b
```

### 3. Start server

```bash
npm start
```

### 4. Open browser

```text
http://localhost:3000
```

### 5. Check syntax

```bash
npm run check
```

---

## Environment Variables

```env
PORT=3000
MAX_BODY_SIZE=18000000
DEFAULT_TIME_ZONE=Asia/Taipei
MAX_TOOL_LOOPS=3

# ===== OpenAI =====
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=
OPENAI_MODELS=gpt-4o-mini,gpt-4o,gpt-4.1-mini,gpt-4.1
OPENAI_FAST_MODEL=gpt-4o-mini
OPENAI_BALANCED_MODEL=gpt-4o
OPENAI_REASONING_MODEL=gpt-4.1
OPENAI_VISION_MODEL=gpt-4o
OPENAI_TOOL_MODEL=gpt-4o-mini

# ===== Self-hosted / compatible provider =====
CLUB_BASE_URL=https://your-llama-server/v1
CLUB_API_KEY=
CLUB_MODELS=qwen35-397b,qwen35-4b
CLUB_FAST_MODEL=qwen35-4b
CLUB_BALANCED_MODEL=qwen35-397b
CLUB_REASONING_MODEL=qwen35-397b
CLUB_VISION_MODEL=qwen35-397b
CLUB_TOOL_MODEL=qwen35-4b
CLUB_SUPPORTS_VISION=false
```

### Notes

- API keys are read from `.env`.
- The frontend no longer includes a manual API key input field.
- If a provider requires a key, the UI will show whether the key was loaded from `.env`.
- Different providers can define different route-model mappings.
- Tool mode disables streaming for that request because the server needs to finish the tool loop first.
- Large images are converted to base64 data URLs, so avoid overly large files.

---

## Provider Model Routing

Each provider can define route-specific models:

- `FAST`
- `BALANCED`
- `REASONING`
- `VISION`
- `TOOL`

For example:

- OpenAI may use:
  - `gpt-4o-mini` for fast/tool
  - `gpt-4o` for balanced/vision
  - `gpt-4.1` for reasoning
- A self-hosted Qwen provider may use:
  - `qwen35-4b` for fast/tool
  - `qwen35-397b` for balanced/reasoning

The system can switch provider and model both manually and automatically.

---

## API Endpoints

### `GET /api/providers`

Returns provider list, supported models, route maps, and capability flags for frontend rendering.

### `GET /api/tools`

Returns available local tools and MCP metadata.

### `POST /api/chat`

Main chat endpoint.

Responsibilities:

- parse request body
- resolve provider
- resolve route / model
- run tool loop when enabled
- forward to upstream provider
- return final model output plus route metadata

### `GET /mcp/manifest`

Returns MCP-style manifest metadata and tool listing.

### `POST /mcp`

JSON-RPC endpoint for MCP-like interactions.

Example:

```bash
curl -X POST http://localhost:3000/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Tool call example:

```bash
curl -X POST http://localhost:3000/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"calculator","arguments":{"expression":"sqrt(144)+7*3"}}}'
```

---

## Long-term Memory Details

### Sources of memory

Memories can be created from:

- manual input in sidebar
- auto-save from user preference statements
- `Remember` on assistant messages

### How relevance works

Before each request, the frontend scores stored memories against the latest user message. Matching tokens and Chinese characters contribute to a simple relevance score. The highest-ranked memories are injected into the request context.

### UI behavior

- `Long-term memory used` under replies shows actual injected memories
- `Search memory` only filters already-saved memories
- blank `Relevant memory limit` means use all relevant matches

---

## Multimodal Details

### Images

- accepted via `image/*`
- converted into `image_url`
- trigger `vision` route when auto routing is on and the latest user message contains an image

### Text-like files

- read as text
- appended into the user request as context
- previewed in chat after sending

---

## Tool Use Details

### Built-in tools

- `calculator`
  - evaluates safe numeric expressions
- `get_current_time`
  - returns current time in a requested timezone
- `text_stats`
  - counts words, lines, characters, and reading time
- `unit_convert`
  - performs common unit conversions
- `memory_search`
  - searches browser-supplied long-term memories

### UI trace

Under assistant replies, the `Tools used` section shows:

- tool name
- arguments
- result

This makes tool execution visible during demo and debugging.

---

## MCP Details

The MCP-style layer exists so the project can demonstrate that tools are not only usable from inside the chat UI, but are also exposed through a structured protocol.

Supported methods:

- `initialize`
- `tools/list`
- `tools/call`

This endpoint is intentionally lightweight and local, making it easy to test during demo or grading.

---

## Common Demo Prompts

### Long-term memory

```text
請記住我偏好繁體中文、條列式、先講結論。
```

```text
幫我做一段這個聊天 app 的簡短 demo opening。
```

### Auto routing

```text
一句話解釋 MCP 是什麼
```

```text
請分析我這個聊天 app 的架構優缺點與可改善處
```

### Multimodal

```text
請描述這張圖片，並幫我整理成 3 個 demo 重點
```

### Tools

```text
Use the calculator tool to compute sqrt(144) + 7 * 3, then explain the answer.
```

```text
Use a tool to tell me the current time in Asia/Taipei and format it for a meeting note.
```

### MCP

```text
一句話解釋 MCP 是什麼，並補充這個 app 如何結合 MCP。
```

---

## Known Constraints

- Tool routing and tool loop behavior depend on upstream model compatibility.
- Vision routing only makes sense when the selected provider truly supports image input.
- Memories are browser-local, not shared across different devices or browsers.
- Very large images can stress request size and browser storage.
- Auto routing is heuristic-based rather than learned or benchmark-optimized.

---

## Scripts

```bash
npm start
npm run check
```

- `npm start`: start the Node.js server
- `npm run check`: syntax-check `server.js` and `public/app.js`

---

## License / Course Context

This repository is an HW2 course project prototype focused on demonstrating integrated LLM application features in a transparent and demo-friendly way.
