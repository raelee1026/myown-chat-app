# HW1 — MyOwn Chat (OpenAI-Compatible Chat App)

This project is a browser-based chat app built for the HW1 assignment. It supports OpenAI-compatible chat APIs and focuses on controllable LLM interaction with a simple full-stack architecture.

- Frontend: HTML + CSS + vanilla JavaScript
- Backend: Node.js native HTTP server (ESM, no framework)
- API pattern: frontend calls local backend; backend forwards to upstream `/chat/completions`

---

## Assignment Requirements (5/5)

### 1) Selectable LLM model
- You can switch provider (`OpenAI` / `NYCU Club`).
- You can type any model name manually.
- Suggested model lists are loaded from provider config.
- This allows the same UI to test different model families without changing source code.

### 2) Custom system prompt
- A dedicated `System Prompt` text area is provided in the sidebar.
- The prompt is prepended as a `system` message for each request.
- This is useful for fixing tone, role, response style, and output constraints across a full chat session.

### 3) Custom common API parameters
- `temperature`: Controls randomness. Lower values make responses more deterministic; higher values make output more varied.
- `top_p`: Controls nucleus sampling. Lower values narrow token selection to high-probability candidates.
- `max_tokens`: Upper bound for generated token length. Helps control response size and cost.
- `presence_penalty`: Encourages introducing new topics by reducing repetition of already-mentioned concepts.
- `frequency_penalty`: Reduces repeated words or phrases by penalizing high-frequency token reuse.

In practice, a common setup is lower `temperature` for factual Q&A, and slightly higher `temperature` for brainstorming.

### 4) Streaming
- Streaming can be toggled on/off.
- In streaming mode, assistant output is rendered incrementally in real time.
- This improves perceived responsiveness for long answers and lets users interrupt early if needed.

### 5) Short-term conversation memory
- `Memory Turns` controls how many recent turns are included in context.
- The app trims history before sending requests, keeping recent context focused.
- This design keeps follow-up quality while preventing context from growing too large.

---

## Special Features

Beyond the 5 required features, this project also includes:

1. **Multi-conversation management**
   - Create, switch, and delete chat threads.
2. **Branch from any message**
   - Create a new conversation branch from a selected message.
3. **One-click chat export**
   - Export current chat + settings (without API keys) as JSON.
4. **Summary card generator**
   - Generate a concise English summary card from current conversation context.
5. **Stop generation**
   - Abort an ongoing response with a `Stop` button.
6. **Persistent local state**
   - Conversations and settings are saved to `localStorage`.
7. **Theme switcher**
   - Built-in `Nebula` / `Aurora` theme toggle.
8. **Markdown rendering + sanitization**
   - Assistant output supports Markdown and is sanitized before rendering.

---

## Project Structure

```text
hw1/
├─ public/
│  ├─ index.html
│  ├─ styles.css
│  └─ app.js
├─ .env.example
├─ .gitignore
├─ demo-script.md
├─ package.json
├─ README.md
└─ server.js
```

---

## Getting Started

### Prerequisites
- Node.js 18+ (Node 22 also works)

### Install & Run

```bash
cp .env.example .env
npm start
```

When server starts successfully, you should see:

```bash
Chat is running on port 3000
```

Open in browser:

```text
Use your local browser with the same port configured by `PORT` in `.env`.
```

---

## Environment Variables

Example in `.env.example`:

```env
PORT=3000

OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=
OPENAI_MODELS=gpt-4o-mini,gpt-4o,gpt-4.1-mini,gpt-4.1

CLUB_BASE_URL=https://your-llama-server/v1
CLUB_API_KEY=
CLUB_MODELS=qwen35-397b,qwen35-4b
```

Notes:
- `OPENAI_MODELS` and `CLUB_MODELS` define suggestion lists in UI.
- API keys are entered per provider from the UI and stored in browser local state.
- `OPENAI_BASE_URL` and `CLUB_BASE_URL` are the only places where upstream URLs should be configured.

---

## Tech Notes

- `server.js`: static file serving, provider config, chat proxy, parameter filtering, streaming relay.
- `public/app.js`: UI state, conversation memory trimming, streaming parser, rendering, export, summary card.
- `public/index.html` + `public/styles.css`: responsive chat layout and themed UI.
