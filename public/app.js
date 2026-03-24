const STORAGE_KEY = 'nebula-chat-state-v1';
const DEFAULT_MODEL_EXAMPLES = ['gpt-4o-mini', 'qwen35-397b'];

const defaultSettings = {
  theme: 'nebula',
  providerId: 'openai',
  model: 'gpt-4o-mini',
  apiKeys: {},
  systemPrompt: 'You are a helpful assistant. Be clear, accurate, and friendly.',
  temperature: 0.7,
  topP: 1,
  maxTokens: 1024,
  presencePenalty: 0,
  frequencyPenalty: 0,
  stream: true,
  memoryTurns: 6,
};

const state = {
  providers: [],
  settings: { ...defaultSettings },
  conversations: [],
  currentConversationId: null,
  messages: [],
  isGenerating: false,
};

const elements = {};
let currentAbortController = null;
let renderScheduled = false;
let summaryLoadingTimer = null;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  cacheElements();
  bindEvents();
  restoreState();
  ensureConversationState();
  syncSettingsToUI();
  autoResizeTextarea(elements.messageInput);
  updateControls();
  renderConversationList();
  renderMessages();
  elements.messageInput.focus();
  await loadProviders();
  updateStatusText();
}

function cacheElements() {
  elements.themeToggleBtn = document.querySelector('#themeToggleBtn');
  elements.providerSelect = document.querySelector('#providerSelect');
  elements.modelInput = document.querySelector('#modelInput');
  elements.apiKeyInput = document.querySelector('#apiKeyInput');
  elements.modelSuggestions = document.querySelector('#modelSuggestions');
  elements.providerMeta = document.querySelector('#providerMeta');
  elements.systemPrompt = document.querySelector('#systemPrompt');

  elements.temperatureInput = document.querySelector('#temperatureInput');
  elements.temperatureValue = document.querySelector('#temperatureValue');
  elements.topPInput = document.querySelector('#topPInput');
  elements.topPValue = document.querySelector('#topPValue');

  elements.maxTokensInput = document.querySelector('#maxTokensInput');
  elements.memoryTurnsInput = document.querySelector('#memoryTurnsInput');
  elements.presencePenaltyInput = document.querySelector('#presencePenaltyInput');
  elements.frequencyPenaltyInput = document.querySelector('#frequencyPenaltyInput');
  elements.streamToggle = document.querySelector('#streamToggle');

  elements.resetSettingsBtn = document.querySelector('#resetSettingsBtn');
  elements.newConversationBtn = document.querySelector('#newConversationBtn');
  elements.conversationList = document.querySelector('#conversationList');
  elements.downloadBtn = document.querySelector('#downloadBtn');
  elements.summaryCardBtn = document.querySelector('#summaryCardBtn');
  elements.newChatBtn = document.querySelector('#newChatBtn');

  elements.errorBanner = document.querySelector('#errorBanner');
  elements.messages = document.querySelector('#messages');
  elements.chatStatus = document.querySelector('#chatStatus');

  elements.composerForm = document.querySelector('#composerForm');
  elements.messageInput = document.querySelector('#messageInput');
  elements.sendBtn = document.querySelector('#sendBtn');
  elements.stopBtn = document.querySelector('#stopBtn');
  elements.emptyStateTemplate = document.querySelector('#emptyStateTemplate');
  elements.summaryCardOverlay = document.querySelector('#summaryCardOverlay');
  elements.summaryCardContent = document.querySelector('#summaryCardContent');
  elements.summaryCardCloseBtn = document.querySelector('#summaryCardCloseBtn');
}

function bindEvents() {
  elements.themeToggleBtn?.addEventListener('click', () => {
    state.settings.theme = state.settings.theme === 'aurora' ? 'nebula' : 'aurora';
    applyTheme();
    syncSettingsToUI();
    persistState();
  });

  elements.providerSelect.addEventListener('change', () => {
    state.settings.providerId = elements.providerSelect.value;
    updateModelSuggestions();

    const provider = getCurrentProvider();
    const suggestedModels = provider?.models || [];
    if (
      !state.settings.model.trim() ||
      (suggestedModels.length && !suggestedModels.includes(state.settings.model.trim()))
    ) {
      state.settings.model = suggestedModels[0] || '';
    }

    syncSettingsToUI();
    persistState();
    updateStatusText();
  });

  elements.modelInput.addEventListener('input', () => {
    const normalized = normalizeModelInput(elements.modelInput.value);
    if (normalized !== elements.modelInput.value) {
      elements.modelInput.value = normalized;
      showError('Model name supports English letters, numbers, and symbols only.');
    }

    state.settings.model = normalized.trim();
    persistState();
    updateStatusText();
  });

  elements.apiKeyInput.addEventListener('input', () => {
    setCurrentProviderApiKey(elements.apiKeyInput.value.trim());
    persistState();
  });

  elements.systemPrompt.addEventListener('input', () => {
    state.settings.systemPrompt = elements.systemPrompt.value;
    persistState();
  });

  elements.temperatureInput.addEventListener('input', () => {
    state.settings.temperature = Number(elements.temperatureInput.value);
    syncOutputs();
    persistState();
  });

  elements.topPInput.addEventListener('input', () => {
    state.settings.topP = Number(elements.topPInput.value);
    syncOutputs();
    persistState();
  });

  elements.maxTokensInput.addEventListener('input', () => {
    state.settings.maxTokens = normalizePositiveInt(elements.maxTokensInput.value, 1024);
    persistState();
  });

  elements.memoryTurnsInput.addEventListener('input', () => {
    state.settings.memoryTurns = clamp(
      normalizePositiveInt(elements.memoryTurnsInput.value, 6),
      1,
      20
    );
    persistState();
    updateStatusText();
  });

  elements.presencePenaltyInput.addEventListener('input', () => {
    state.settings.presencePenalty = clamp(
      normalizeNumber(elements.presencePenaltyInput.value, 0),
      -2,
      2
    );
    persistState();
  });

  elements.frequencyPenaltyInput.addEventListener('input', () => {
    state.settings.frequencyPenalty = clamp(
      normalizeNumber(elements.frequencyPenaltyInput.value, 0),
      -2,
      2
    );
    persistState();
  });

  elements.streamToggle.addEventListener('change', () => {
    state.settings.stream = elements.streamToggle.checked;
    persistState();
    updateStatusText();
  });

  elements.resetSettingsBtn.addEventListener('click', () => {
    const providerId = state.settings.providerId;
    state.settings = {
      ...defaultSettings,
      providerId,
    };

    const provider = getCurrentProvider();
    if (provider?.models?.length) {
      state.settings.model = provider.models[0];
    }

    syncSettingsToUI();
    persistState();
    updateStatusText();
  });

  elements.newConversationBtn?.addEventListener('click', () => {
    createAndSwitchConversation();
  });

  elements.newChatBtn.addEventListener('click', () => {
    createAndSwitchConversation();
  });

  elements.downloadBtn.addEventListener('click', exportConversation);

  elements.summaryCardBtn?.addEventListener('click', async () => {
    if (state.isGenerating) return;
    await generateSummaryCard();
  });

  elements.summaryCardCloseBtn?.addEventListener('click', hideSummaryCard);
  elements.summaryCardOverlay?.addEventListener('click', (event) => {
    if (event.target === elements.summaryCardOverlay) hideSummaryCard();
  });

  elements.messageInput.addEventListener('input', () => {
    autoResizeTextarea(elements.messageInput);
  });

  elements.messageInput.addEventListener('keydown', (event) => {
    if (event.isComposing || event.keyCode === 229) {
      return;
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      elements.composerForm.requestSubmit();
    }
  });

  elements.composerForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = elements.messageInput.value.trim();
    if (!text || state.isGenerating) return;

    elements.messageInput.value = '';
    autoResizeTextarea(elements.messageInput);

    await sendMessage(text);
  });

  elements.stopBtn.addEventListener('click', () => {
    if (currentAbortController) {
      currentAbortController.abort();
    }
  });
}

async function loadProviders() {
  try {
    const response = await fetch('/api/providers');
    if (!response.ok) {
      throw new Error('Failed to load provider settings');
    }

    const data = await response.json();
    state.providers = Array.isArray(data.providers) ? data.providers : [];
    populateProviders();

    if (!state.providers.some((provider) => provider.id === state.settings.providerId)) {
      state.settings.providerId = state.providers[0]?.id || defaultSettings.providerId;
    }

    const provider = getCurrentProvider();
    if (provider && !state.settings.model.trim()) {
      state.settings.model = provider.models?.[0] || '';
    }

    syncSettingsToUI();
    persistState();
  } catch (error) {
    showError(getErrorMessage(error));
  }
}

function populateProviders() {
  elements.providerSelect.innerHTML = '';

  state.providers.forEach((provider) => {
    const option = document.createElement('option');
    option.value = provider.id;
    option.textContent = provider.name;
    elements.providerSelect.appendChild(option);
  });

  updateModelSuggestions();
}

function updateModelSuggestions() {
  const provider = getCurrentProvider();
  const models = provider?.models?.length ? provider.models : DEFAULT_MODEL_EXAMPLES;
  elements.modelSuggestions.innerHTML = '';

  for (const model of models.slice(0, 2)) {
    const option = document.createElement('option');
    option.value = model;
    elements.modelSuggestions.appendChild(option);
  }

  elements.providerMeta.textContent = provider
    ? `${provider.name} | ${provider?.requiresKey ? 'API key required' : 'API key optional'}`
    : 'Provider not loaded yet';
}

function getCurrentProvider() {
  return state.providers.find((provider) => provider.id === state.settings.providerId) || null;
}

function syncSettingsToUI() {
  const activeTheme = normalizeTheme(state.settings.theme);
  if (elements.themeToggleBtn) {
    elements.themeToggleBtn.textContent = activeTheme === 'aurora' ? 'Aurora' : 'Nebula';
    elements.themeToggleBtn.setAttribute(
      'aria-label',
      `Current theme: ${activeTheme}. Click to switch theme.`
    );
  }
  elements.providerSelect.value = state.settings.providerId;
  elements.modelInput.value = state.settings.model;
  syncApiKeyToUI();
  elements.systemPrompt.value = state.settings.systemPrompt;

  elements.temperatureInput.value = String(state.settings.temperature);
  elements.topPInput.value = String(state.settings.topP);
  elements.maxTokensInput.value = String(state.settings.maxTokens);
  elements.memoryTurnsInput.value = String(state.settings.memoryTurns);
  elements.presencePenaltyInput.value = String(state.settings.presencePenalty);
  elements.frequencyPenaltyInput.value = String(state.settings.frequencyPenalty);
  elements.streamToggle.checked = state.settings.stream;

  syncOutputs();
  updateModelSuggestions();
  applyTheme();
}

function syncApiKeyToUI() {
  if (!elements.apiKeyInput) return;
  elements.apiKeyInput.value = getCurrentProviderApiKey();
}

function getCurrentProviderApiKey() {
  const providerId = state.settings.providerId;
  const apiKeys = state.settings.apiKeys || {};
  const key = apiKeys[providerId];
  return typeof key === 'string' ? key : '';
}

function setCurrentProviderApiKey(value) {
  const providerId = state.settings.providerId;
  if (!providerId) return;

  if (!state.settings.apiKeys || typeof state.settings.apiKeys !== 'object') {
    state.settings.apiKeys = {};
  }

  if (value) {
    state.settings.apiKeys[providerId] = value;
  } else {
    delete state.settings.apiKeys[providerId];
  }
}

function syncOutputs() {
  elements.temperatureValue.value = Number(state.settings.temperature).toFixed(1);
  elements.topPValue.value = Number(state.settings.topP).toFixed(2);
}

function persistState() {
  syncActiveConversationFromState();

  const data = {
    settings: state.settings,
    conversations: state.conversations,
    currentConversationId: state.currentConversationId,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function restoreState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    const saved = JSON.parse(raw);
    if (saved.settings) {
      state.settings = {
        ...defaultSettings,
        ...saved.settings,
      };

      state.settings.theme = normalizeTheme(state.settings.theme);

      if (!state.settings.apiKeys || typeof state.settings.apiKeys !== 'object') {
        state.settings.apiKeys = {};
      }
    }

    if (Array.isArray(saved.conversations)) {
      state.conversations = saved.conversations.map((conversation) => ({
        id: typeof conversation?.id === 'string' ? conversation.id : createConversation().id,
        title:
          typeof conversation?.title === 'string' && conversation.title.trim()
            ? conversation.title.trim()
            : 'New Chat',
        createdAt:
          typeof conversation?.createdAt === 'string'
            ? conversation.createdAt
            : new Date().toISOString(),
        updatedAt:
          typeof conversation?.updatedAt === 'string'
            ? conversation.updatedAt
            : new Date().toISOString(),
        messages: Array.isArray(conversation?.messages)
          ? conversation.messages
              .filter(isValidMessage)
              .map((message) => ({ ...message, pending: false }))
          : [],
      }));
      state.currentConversationId =
        typeof saved.currentConversationId === 'string' ? saved.currentConversationId : null;
    } else if (Array.isArray(saved.messages)) {
      const migrated = createConversation('New Chat');
      migrated.messages = saved.messages
        .filter(isValidMessage)
        .map((message) => ({
          ...message,
          pending: false,
        }));
      state.conversations = [migrated];
      state.currentConversationId = migrated.id;
    }
  } catch {
    // Ignore invalid localStorage payload.
  }
}

function createConversation(title = 'New Chat') {
  return {
    id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
    title,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: [],
  };
}

function getCurrentConversation() {
  return state.conversations.find((conversation) => conversation.id === state.currentConversationId);
}

function ensureConversationState() {
  if (!Array.isArray(state.conversations)) {
    state.conversations = [];
  }

  if (!state.conversations.length) {
    const conversation = createConversation();
    state.conversations = [conversation];
    state.currentConversationId = conversation.id;
  }

  if (!state.currentConversationId) {
    state.currentConversationId = state.conversations[0].id;
  }

  const exists = state.conversations.some(
    (conversation) => conversation.id === state.currentConversationId
  );
  if (!exists) {
    state.currentConversationId = state.conversations[0].id;
  }

  syncMessagesFromCurrentConversation();
}

function syncMessagesFromCurrentConversation() {
  const current = getCurrentConversation();
  state.messages = Array.isArray(current?.messages)
    ? current.messages.map((message) => ({ ...message, pending: false }))
    : [];
}

function syncActiveConversationFromState() {
  const current = getCurrentConversation();
  if (!current) return;

  current.messages = state.messages.map((message) => ({
    ...message,
    pending: false,
  }));
  current.updatedAt = new Date().toISOString();

  if (!current.title || current.title === 'New Chat') {
    const firstUser = current.messages.find(
      (message) => message.role === 'user' && message.content.trim()
    );
    if (firstUser) {
      current.title = firstUser.content.trim().slice(0, 44);
    }
  }
}

function createAndSwitchConversation() {
  if (state.isGenerating) return;

  syncActiveConversationFromState();
  const conversation = createConversation();
  state.conversations.unshift(conversation);
  state.currentConversationId = conversation.id;
  state.messages = [];
  hideError();
  persistState();
  renderConversationList();
  renderMessages();
  elements.messageInput.focus();
}

function createBranchFromMessage(messageId) {
  if (!messageId || state.isGenerating) return;

  syncActiveConversationFromState();
  const sourceConversation = getCurrentConversation();
  const branchIndex = state.messages.findIndex((message) => message.id === messageId);
  if (branchIndex < 0) return;

  const history = state.messages
    .slice(0, branchIndex + 1)
    .filter((message) => !message.pending)
    .map((message) => ({
      ...message,
      id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
      pending: false,
    }));

  if (!history.length) return;

  const anchor = history[history.length - 1];
  const anchorText = String(anchor?.content || '').trim().slice(0, 36);
  const baseTitle =
    sourceConversation?.title && sourceConversation.title !== 'New Chat'
      ? sourceConversation.title
      : 'New Chat';

  const conversation = createConversation(
    anchorText ? `Branch · ${anchorText}` : `Branch of ${baseTitle}`
  );
  conversation.messages = history;
  conversation.updatedAt = new Date().toISOString();

  state.conversations.unshift(conversation);
  state.currentConversationId = conversation.id;
  syncMessagesFromCurrentConversation();

  hideError();
  persistState();
  renderConversationList();
  renderMessages();
  elements.messageInput.focus();
}

function switchConversation(conversationId) {
  if (!conversationId || state.isGenerating) return;
  if (conversationId === state.currentConversationId) return;

  syncActiveConversationFromState();
  state.currentConversationId = conversationId;
  syncMessagesFromCurrentConversation();
  hideError();
  persistState();
  renderConversationList();
  renderMessages();
}

function deleteConversation(conversationId) {
  if (!conversationId || state.isGenerating) return;

  const target = state.conversations.find((conversation) => conversation.id === conversationId);
  if (!target) return;

  const ok = window.confirm(`Delete this chat: "${target.title || 'New Chat'}"?`);
  if (!ok) return;

  state.conversations = state.conversations.filter(
    (conversation) => conversation.id !== conversationId
  );

  if (!state.conversations.length) {
    const conversation = createConversation();
    state.conversations = [conversation];
    state.currentConversationId = conversation.id;
  } else if (state.currentConversationId === conversationId) {
    state.currentConversationId = state.conversations[0].id;
  }

  syncMessagesFromCurrentConversation();
  hideError();
  persistState();
  renderConversationList();
  renderMessages();
}

function renderConversationList() {
  if (!elements.conversationList) return;

  elements.conversationList.innerHTML = '';

  for (const conversation of state.conversations) {
    const row = document.createElement('div');
    row.className = 'conversation-list__row';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'conversation-list__item';
    if (conversation.id === state.currentConversationId) {
      button.classList.add('conversation-list__item--active');
    }

    const title = document.createElement('div');
    title.className = 'conversation-list__title';
    title.textContent = conversation.title || 'New Chat';

    const meta = document.createElement('div');
    meta.className = 'conversation-list__meta';
    meta.textContent = formatTime(conversation.updatedAt);

    button.append(title, meta);
    button.addEventListener('click', () => {
      switchConversation(conversation.id);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'conversation-list__delete';
    deleteBtn.textContent = 'Delete';
    deleteBtn.setAttribute('aria-label', `Delete ${conversation.title || 'New Chat'}`);
    deleteBtn.addEventListener('click', () => {
      deleteConversation(conversation.id);
    });

    row.append(button, deleteBtn);
    elements.conversationList.appendChild(row);
  }
}

function isValidMessage(message) {
  return (
    message &&
    typeof message === 'object' &&
    (message.role === 'user' || message.role === 'assistant') &&
    typeof message.content === 'string'
  );
}

function normalizePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeModelInput(value) {
  return String(value || '').replace(/[\u3400-\u9FFF]/g, '');
}

function isModelNameValid(value) {
  const model = String(value || '').trim();
  if (!model) return false;
  if (/[\u3400-\u9FFF]/.test(model)) return false;
  return /^[A-Za-z0-9._:/-]+$/.test(model);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeTheme(value) {
  return value === 'aurora' ? 'aurora' : 'nebula';
}

function applyTheme() {
  const theme = normalizeTheme(state.settings.theme);
  state.settings.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
}

function createMessage(role, content = '', extra = {}) {
  return {
    id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
    role,
    content,
    createdAt: new Date().toISOString(),
    pending: false,
    ...extra,
  };
}

function updateStatusText() {
  const provider = getCurrentProvider();
  const providerName = provider?.name || 'Provider';
  const model = state.settings.model || 'No model selected';
  const streamingLabel = state.settings.stream ? 'Streaming On' : 'Streaming Off';
  const memoryLabel = `Memory ${state.settings.memoryTurns} turns`;
  elements.chatStatus.textContent = `${providerName} / ${model} | ${streamingLabel} | ${memoryLabel}`;
}

function renderMessages() {
  elements.messages.innerHTML = '';

  if (!state.messages.length) {
    const spacer = document.createElement('div');
    spacer.className = 'messages__spacer';
    elements.messages.appendChild(spacer);

    const fragment = elements.emptyStateTemplate.content.cloneNode(true);
    elements.messages.appendChild(fragment);
    elements.messages.scrollTop = elements.messages.scrollHeight;
    return;
  }

  const spacer = document.createElement('div');
  spacer.className = 'messages__spacer';
  elements.messages.appendChild(spacer);

  state.messages.forEach((message) => {
    const article = document.createElement('article');
    article.className = `message message--${message.role}`;

    const bubble = document.createElement('div');
    bubble.className = 'message__bubble';
    if (message.pending) {
      bubble.classList.add('message__bubble--pending');
    }

    const header = document.createElement('div');
    header.className = 'message__header';

    const meta = document.createElement('div');
    meta.className = 'message__meta';

    const avatar = document.createElement('div');
    avatar.className = `message__avatar message__avatar--${message.role}`;
    avatar.textContent = getMessageAvatar(message);

    const role = document.createElement('div');
    role.className = 'message__role';
    role.textContent = getMessageRoleLabel(message);

    meta.append(avatar, role);

    const right = document.createElement('div');
    right.className = 'message__header-actions';

    const time = document.createElement('time');
    time.dateTime = message.createdAt || '';
    time.textContent = formatTime(message.createdAt);

    const branchBtn = document.createElement('button');
    branchBtn.type = 'button';
    branchBtn.className = 'message__branch-btn';
    branchBtn.textContent = 'Branch';
    branchBtn.disabled = state.isGenerating || !!message.pending;
    branchBtn.setAttribute('aria-label', 'Branch from this message');
    branchBtn.addEventListener('click', () => {
      createBranchFromMessage(message.id);
    });

    right.append(time, branchBtn);
    header.append(meta, right);

    const content = document.createElement('div');
    content.className = 'message__content';
    content.innerHTML = renderRichText(message.content || '');

    bubble.append(header, content);
    article.appendChild(bubble);
    elements.messages.appendChild(article);
  });

  elements.messages.scrollTop = elements.messages.scrollHeight;
}

function getMessageRoleLabel(message) {
  if (message.role === 'user') return 'You';

  const provider = state.providers.find((item) => item.id === message.providerId);
  const providerName = provider?.name || 'Assistant';
  const model = String(message.model || '').trim();
  return model ? `${providerName} · ${model}` : providerName;
}

function getMessageAvatar(message) {
  if (message.role === 'user') {
    return '🧑';
  }

  const model = String(message.model || '').toLowerCase();

  if (model.includes('gpt-4o')) return '🧠';
  if (model.includes('gpt-4.1')) return '✨';
  if (model.includes('qwen')) return '🦉';
  if (model.includes('llama')) return '🦙';

  return '🤖';
}

function scheduleRender() {
  if (renderScheduled) return;
  renderScheduled = true;

  requestAnimationFrame(() => {
    renderScheduled = false;
    renderMessages();
  });
}

function formatTime(isoString) {
  const date = isoString ? new Date(isoString) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function escapeHtml(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderRichText(text) {
  const raw = String(text || '');

  const parseMarkdown = globalThis.marked?.parse;
  const sanitize = globalThis.DOMPurify?.sanitize;

  if (typeof parseMarkdown === 'function') {
    const unsafeHtml = parseMarkdown(raw, {
      breaks: true,
      gfm: true,
    });

    if (typeof sanitize === 'function') {
      return sanitize(unsafeHtml);
    }

    return unsafeHtml;
  }

  const escaped = escapeHtml(raw);
  const blocks = [];

  let working = escaped.replace(/```([\w-]+)?\n?([\s\S]*?)```/g, (_match, lang, code) => {
    const placeholder = `__CODE_BLOCK_${blocks.length}__`;
    blocks.push(
      `<pre><code data-lang="${lang || ''}">${code.replace(/\n$/, '')}</code></pre>`
    );
    return `\n${placeholder}\n`;
  });

  const segments = working
    .split(/\n{2,}/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => {
      if (/^__CODE_BLOCK_\d+__$/.test(segment)) {
        return segment;
      }

      return `<p>${segment
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\n/g, '<br />')}</p>`;
    });

  let html = segments.join('');
  blocks.forEach((block, index) => {
    html = html.replace(`__CODE_BLOCK_${index}__`, block);
  });

  return html || '<p></p>';
}

function autoResizeTextarea(textarea) {
  textarea.style.height = '96px';
}

function showError(message) {
  elements.errorBanner.textContent = message;
  elements.errorBanner.classList.remove('hidden');
}

function hideError() {
  elements.errorBanner.classList.add('hidden');
  elements.errorBanner.textContent = '';
}

function buildRequestMessages() {
  const conversation = state.messages
    .filter((message) => !message.pending)
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));

  const trimmed = trimConversationByTurns(conversation, state.settings.memoryTurns);

  if (state.settings.systemPrompt.trim()) {
    return [
      {
        role: 'system',
        content: state.settings.systemPrompt.trim(),
      },
      ...trimmed,
    ];
  }

  return trimmed;
}

function trimConversationByTurns(messages, memoryTurns) {
  const limit = Math.max(1, memoryTurns) * 2;
  let trimmed = messages.slice(-limit);

  if (trimmed[0]?.role === 'assistant') {
    trimmed = trimmed.slice(1);
  }

  return trimmed;
}

function extractTextContent(content) {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part?.type === 'text') return part.text || '';
        return '';
      })
      .join('');
  }

  return '';
}

function extractAssistantText(payload) {
  const choice = payload?.choices?.[0];
  return extractTextContent(choice?.message?.content) || '';
}

function extractDeltaText(delta) {
  return extractTextContent(delta?.content) || '';
}

function parseErrorPayload(text) {
  if (!text) return 'Request failed';
  try {
    const json = JSON.parse(text);
    return (
      json?.error?.message ||
      json?.error ||
      json?.message ||
      text
    );
  } catch {
    return text;
  }
}

async function readStreamResponse(response, assistantMessage) {
  if (!response.body) return;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split(/\r?\n\r?\n/);
    buffer = parts.pop() || '';

    for (const part of parts) {
      processSSEEvent(part, assistantMessage);
    }

    scheduleRender();
  }

  if (buffer.trim()) {
    processSSEEvent(buffer, assistantMessage);
    scheduleRender();
  }
}

function processSSEEvent(rawEvent, assistantMessage) {
  const lines = rawEvent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (!line.startsWith('data:')) continue;

    const payload = line.slice(5).trim();
    if (!payload) continue;
    if (payload === '[DONE]') return;

    try {
      const json = JSON.parse(payload);
      const delta = json?.choices?.[0]?.delta;
      const text = extractDeltaText(delta);

      if (text) {
        assistantMessage.content += text;
      }
    } catch {
      // Ignore partial/non-JSON SSE chunks.
    }
  }
}

async function sendMessage(text) {
  hideError();

  const selectedModel = state.settings.model.trim();
  if (!isModelNameValid(selectedModel)) {
    showError('Please enter a valid model name (English letters/numbers/symbols only).');
    return;
  }

  const userMessage = createMessage('user', text, {
    providerId: state.settings.providerId,
  });
  const assistantMessage = createMessage('assistant', '', {
    pending: true,
    providerId: state.settings.providerId,
    model: selectedModel,
  });

  state.messages.push(userMessage);
  state.messages.push(assistantMessage);
  state.isGenerating = true;
  persistState();
  renderConversationList();
  scheduleRender();
  updateControls();

  const payload = {
    providerId: state.settings.providerId,
    model: selectedModel,
    apiKey: getCurrentProviderApiKey(),
    stream: state.settings.stream,
    parameters: {
      temperature: state.settings.temperature,
      top_p: state.settings.topP,
      max_tokens: state.settings.maxTokens,
      presence_penalty: state.settings.presencePenalty,
      frequency_penalty: state.settings.frequencyPenalty,
    },
    messages: buildRequestMessages(),
  };

  currentAbortController = new AbortController();

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: currentAbortController.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(parseErrorPayload(errorText));
    }

    if (state.settings.stream) {
      await readStreamResponse(response, assistantMessage);
    } else {
      const data = await response.json();
      assistantMessage.content =
        extractAssistantText(data) || '(No text content was returned by the model.)';
    }

    if (!assistantMessage.content.trim()) {
      assistantMessage.content = '(Completed, but no displayable text was returned.)';
    }
  } catch (error) {
    const isAborted = currentAbortController?.signal?.aborted;

    if (isAborted) {
      if (!assistantMessage.content.trim()) {
        assistantMessage.content = '⏹️ Generation stopped.';
      }
    } else {
      const message = getErrorMessage(error);
      state.messages = state.messages.filter((item) => item.id !== assistantMessage.id);
      showError(message);
    }
  } finally {
    assistantMessage.pending = false;
    state.isGenerating = false;
    currentAbortController = null;
    persistState();
    renderConversationList();
    scheduleRender();
    updateControls();
  }
}

function updateControls() {
  const disabled = state.isGenerating;

  elements.sendBtn.disabled = disabled;
  elements.stopBtn.disabled = !disabled;

  elements.providerSelect.disabled = disabled;
  elements.modelInput.disabled = disabled;
  elements.apiKeyInput.disabled = disabled;
  elements.systemPrompt.disabled = disabled;
  elements.temperatureInput.disabled = disabled;
  elements.topPInput.disabled = disabled;
  elements.maxTokensInput.disabled = disabled;
  elements.memoryTurnsInput.disabled = disabled;
  elements.presencePenaltyInput.disabled = disabled;
  elements.frequencyPenaltyInput.disabled = disabled;
  elements.streamToggle.disabled = disabled;
  if (elements.themeToggleBtn) {
    elements.themeToggleBtn.disabled = disabled;
  }
  elements.resetSettingsBtn.disabled = disabled;
  elements.newChatBtn.disabled = disabled;
  if (elements.summaryCardBtn) {
    elements.summaryCardBtn.disabled = disabled;
  }
  if (elements.newConversationBtn) {
    elements.newConversationBtn.disabled = disabled;
  }

  elements.messages
    ?.querySelectorAll('.message__branch-btn')
    .forEach((button) => {
      button.disabled = disabled || button.disabled;
    });
}

function getErrorMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error || 'Unknown error occurred');
}

function exportConversation() {
  const { apiKeys, ...safeSettings } = state.settings;

  const payload = {
    exportedAt: new Date().toISOString(),
    settings: safeSettings,
    messages: state.messages.map(({ pending, ...message }) => message),
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  const timestamp = new Date().toISOString().replaceAll(':', '-');
  anchor.href = url;
  anchor.download = `chat-export-${timestamp}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  URL.revokeObjectURL(url);
}

function isSummaryCardCommand(text) {
  const raw = String(text || '');
  return raw.includes('聊天摘要小卡') && raw.includes('完成小卡');
}

function buildSummaryCardFallback() {
  return 'This chat focused on key decisions and next steps. The team aligned on priorities and identified immediate follow-up actions.';
}

function buildSummaryCardRequestMessages() {
  const source = trimConversationByTurns(
    state.messages
      .filter((message) => !message.pending && String(message.content || '').trim())
      .map((message) => ({
        role: message.role,
        content: String(message.content || '').slice(0, 1800),
      })),
    state.settings.memoryTurns
  );

  const transcript = source
    .map((message) => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content}`)
    .join('\n\n');

  return [
    {
      role: 'system',
      content:
        'Summarize the conversation in English using exactly 2 to 3 concise sentences. No bullets, no headings, no extra formatting.',
    },
    {
      role: 'user',
      content: `Conversation:
${transcript || '(No available conversation yet)'}`,
    },
  ];
}

function startSummaryLoadingAnimation() {
  stopSummaryLoadingAnimation();
  const frames = ['Generating summary', 'Generating summary.', 'Generating summary..', 'Generating summary...'];
  let index = 0;
  showSummaryCard(frames[index]);
  summaryLoadingTimer = globalThis.setInterval(() => {
    index = (index + 1) % frames.length;
    showSummaryCard(frames[index]);
  }, 350);
}

function stopSummaryLoadingAnimation() {
  if (!summaryLoadingTimer) return;
  clearInterval(summaryLoadingTimer);
  summaryLoadingTimer = null;
}

async function generateSummaryCard() {
  hideError();

  const selectedModel = state.settings.model.trim();
  if (!isModelNameValid(selectedModel)) {
    showError('Please enter a valid model name (English letters/numbers/symbols only).');
    return;
  }

  const hasContent = state.messages.some(
    (message) => !message.pending && String(message.content || '').trim()
  );
  if (!hasContent) {
    showError('No conversation content available for summary.');
    return;
  }

  state.isGenerating = true;
  updateControls();
  startSummaryLoadingAnimation();

  const payload = {
    providerId: state.settings.providerId,
    model: selectedModel,
    apiKey: getCurrentProviderApiKey(),
    stream: false,
    parameters: {
      temperature: 0.3,
      top_p: state.settings.topP,
      max_tokens: Math.min(state.settings.maxTokens, 220),
      presence_penalty: 0,
      frequency_penalty: 0,
    },
    messages: buildSummaryCardRequestMessages(),
  };

  currentAbortController = new AbortController();

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: currentAbortController.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(parseErrorPayload(errorText));
    }

    const data = await response.json();
    stopSummaryLoadingAnimation();
    showSummaryCard((extractAssistantText(data) || buildSummaryCardFallback()).trim());
  } catch (error) {
    const isAborted = currentAbortController?.signal?.aborted;
    stopSummaryLoadingAnimation();

    if (isAborted) {
      showSummaryCard('Summary generation stopped.');
    } else {
      hideSummaryCard();
      showError(getErrorMessage(error));
    }
  } finally {
    state.isGenerating = false;
    currentAbortController = null;
    updateControls();
  }
}

function hideSummaryCard() {
  if (!elements.summaryCardOverlay || !elements.summaryCardContent) return;
  stopSummaryLoadingAnimation();
  elements.summaryCardOverlay.classList.add('hidden');
  elements.summaryCardOverlay.setAttribute('aria-hidden', 'true');
  elements.summaryCardContent.textContent = '';
}

function showSummaryCard(text) {
  if (!elements.summaryCardOverlay || !elements.summaryCardContent) return;
  elements.summaryCardContent.textContent = String(text || '');
  elements.summaryCardOverlay.classList.remove('hidden');
  elements.summaryCardOverlay.setAttribute('aria-hidden', 'false');
}
