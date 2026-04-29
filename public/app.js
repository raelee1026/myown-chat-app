const STORAGE_KEY = 'nebula-chat-state-v2';
const DEFAULT_MODEL_EXAMPLES = ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'qwen35-397b'];
const MAX_ATTACHMENTS = 4;
const MAX_ATTACHMENT_BYTES = 1_800_000;
const TEXT_ATTACHMENT_BYTES = 200_000;

const defaultSettings = {
  theme: 'nebula',
  providerId: 'openai',
  model: 'gpt-4o-mini',
  systemPrompt: 'You are a helpful assistant. Be clear, accurate, and friendly.',
  temperature: 0.7,
  topP: 1,
  maxTokens: 1024,
  presencePenalty: 0,
  frequencyPenalty: 0,
  stream: true,
  memoryTurns: 6,
  routingMode: 'manual',
  routeProfile: 'balanced',
  toolsEnabled: false,
  mcpEnabled: false,
  longTermMemoryEnabled: true,
  autoMemory: true,
  maxLongTermMemories: null,
};

const state = {
  providers: [],
  settings: { ...defaultSettings },
  conversations: [],
  currentConversationId: null,
  messages: [],
  memories: [],
  pendingAttachments: [],
  availableTools: [],
  mcpInfo: null,
  lastRouteDecision: null,
  isGenerating: false,
  isDictating: false,
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
  renderMemoryList();
  renderAttachmentPreview();
  elements.messageInput.focus();
  await loadProviders();
  await loadTools();
  updateStatusText();
}

function cacheElements() {
  elements.sidebar = document.querySelector('.sidebar');
  elements.themeToggleBtn = document.querySelector('#themeToggleBtn');
  elements.providerSelect = document.querySelector('#providerSelect');
  elements.modelInput = document.querySelector('#modelInput');
  elements.modelSuggestions = document.querySelector('#modelSuggestions');
  elements.providerMeta = document.querySelector('#providerMeta');
  elements.routingModeSelect = document.querySelector('#routingModeSelect');
  elements.routeProfileSelect = document.querySelector('#routeProfileSelect');
  elements.routeDecision = document.querySelector('#routeDecision');
  elements.toolsToggle = document.querySelector('#toolsToggle');
  elements.mcpToggle = document.querySelector('#mcpToggle');
  elements.toolList = document.querySelector('#toolList');
  elements.toolDemoButtons = Array.from(document.querySelectorAll('[data-tool-demo]'));
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

  elements.memoryToggle = document.querySelector('#memoryToggle');
  elements.autoMemoryToggle = document.querySelector('#autoMemoryToggle');
  elements.maxLongTermMemoriesInput = document.querySelector('#maxLongTermMemoriesInput');
  elements.memoryInput = document.querySelector('#memoryInput');
  elements.memorySearchInput = document.querySelector('#memorySearchInput');
  elements.addMemoryBtn = document.querySelector('#addMemoryBtn');
  elements.clearMemoriesBtn = document.querySelector('#clearMemoriesBtn');
  elements.memoryList = document.querySelector('#memoryList');
  elements.memoryCount = document.querySelector('#memoryCount');

  elements.attachmentInput = document.querySelector('#attachmentInput');
  elements.attachBtn = document.querySelector('#attachBtn');
  elements.clearAttachmentsBtn = document.querySelector('#clearAttachmentsBtn');
  elements.attachmentPreview = document.querySelector('#attachmentPreview');
  elements.voiceBtn = document.querySelector('#voiceBtn');
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


  elements.routingModeSelect?.addEventListener('change', () => {
    state.settings.routingMode = elements.routingModeSelect.value === 'auto' ? 'auto' : 'manual';
    syncSettingsToUI();
    persistState();
    updateStatusText();
  });

  elements.routeProfileSelect?.addEventListener('change', () => {
    state.settings.routeProfile = normalizeRouteProfile(elements.routeProfileSelect.value);
    syncSettingsToUI();
    persistState();
    updateStatusText();
  });

  elements.toolsToggle?.addEventListener('change', () => {
    state.settings.toolsEnabled = elements.toolsToggle.checked;
    if (!state.settings.toolsEnabled) {
      state.settings.mcpEnabled = false;
    }
    syncSettingsToUI();
    persistState();
    updateStatusText();
  });

  elements.mcpToggle?.addEventListener('change', () => {
    state.settings.mcpEnabled = elements.mcpToggle.checked;
    if (state.settings.mcpEnabled) {
      state.settings.toolsEnabled = true;
    }
    syncSettingsToUI();
    persistState();
    updateStatusText();
  });

  elements.toolDemoButtons?.forEach((button) => {
    button.addEventListener('click', () => {
      const prompt = button.getAttribute('data-tool-demo') || '';
      elements.messageInput.value = prompt;
      autoResizeTextarea(elements.messageInput);
      elements.messageInput.focus();
    });
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

  elements.memoryToggle?.addEventListener('change', () => {
    state.settings.longTermMemoryEnabled = elements.memoryToggle.checked;
    persistState();
    updateStatusText();
  });

  elements.autoMemoryToggle?.addEventListener('change', () => {
    state.settings.autoMemory = elements.autoMemoryToggle.checked;
    persistState();
  });

  elements.maxLongTermMemoriesInput?.addEventListener('input', () => {
    const rawValue = String(elements.maxLongTermMemoriesInput.value || '').trim();
    state.settings.maxLongTermMemories = rawValue
      ? Math.max(1, normalizePositiveInt(rawValue, 1))
      : null;
    persistState();
    updateStatusText();
  });

  elements.addMemoryBtn?.addEventListener('click', () => {
    const text = elements.memoryInput.value.trim();
    if (!text) return;
    addMemory(text, { source: 'manual' });
    elements.memoryInput.value = '';
  });

  elements.memoryInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      elements.addMemoryBtn?.click();
    }
  });

  elements.memorySearchInput?.addEventListener('input', () => {
    renderMemoryList();
  });

  elements.clearMemoriesBtn?.addEventListener('click', () => {
    if (!state.memories.length) return;
    const ok = window.confirm('Clear all long-term memories?');
    if (!ok) return;
    state.memories = [];
    persistState();
    renderMemoryList();
    updateStatusText();
  });

  elements.attachBtn?.addEventListener('click', () => {
    elements.attachmentInput?.click();
  });

  elements.attachmentInput?.addEventListener('change', async () => {
    await addPendingAttachments(elements.attachmentInput.files);
    elements.attachmentInput.value = '';
  });

  elements.clearAttachmentsBtn?.addEventListener('click', () => {
    state.pendingAttachments = [];
    renderAttachmentPreview();
  });

  elements.voiceBtn?.addEventListener('click', toggleVoiceDictation);

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
    if ((!text && !state.pendingAttachments.length) || state.isGenerating) return;

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


async function loadTools() {
  try {
    const response = await fetch('/api/tools');
    if (!response.ok) {
      throw new Error('Failed to load local tools');
    }

    const data = await response.json();
    state.availableTools = Array.isArray(data.tools) ? data.tools : [];
    state.mcpInfo = data.mcp || null;
    renderToolList();
  } catch (error) {
    state.availableTools = [];
    renderToolList();
    console.warn('Tool list unavailable:', getErrorMessage(error));
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

  const routeModels = provider?.routes ? Object.values(provider.routes) : [];
  const suggestions = [...new Set([...models, ...routeModels, ...DEFAULT_MODEL_EXAMPLES])].filter(Boolean);

  for (const model of suggestions) {
    const option = document.createElement('option');
    option.value = model;
    elements.modelSuggestions.appendChild(option);
  }

  const capabilityLabels = provider?.capabilities
    ? Object.entries(provider.capabilities)
        .filter(([, enabled]) => enabled)
        .map(([name]) => name)
        .join(', ')
    : '';

  elements.providerMeta.textContent = provider
    ? `${provider.name} | ${provider?.requiresKey ? (provider?.hasServerKey ? 'API key loaded from .env' : 'Missing API key in .env') : 'No API key required'} | ${capabilityLabels || 'text'}`
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
  elements.systemPrompt.value = state.settings.systemPrompt;

  elements.temperatureInput.value = String(state.settings.temperature);
  elements.topPInput.value = String(state.settings.topP);
  elements.maxTokensInput.value = String(state.settings.maxTokens);
  elements.memoryTurnsInput.value = String(state.settings.memoryTurns);
  elements.presencePenaltyInput.value = String(state.settings.presencePenalty);
  elements.frequencyPenaltyInput.value = String(state.settings.frequencyPenalty);
  elements.streamToggle.checked = state.settings.stream;
  if (elements.messageInput) {
    elements.messageInput.placeholder =
      'Type a message, attach image/text, or use /image <prompt> to generate an image';
  }

  if (elements.routingModeSelect) elements.routingModeSelect.value = state.settings.routingMode;
  if (elements.routeProfileSelect) elements.routeProfileSelect.value = normalizeRouteProfile(state.settings.routeProfile);
  if (elements.toolsToggle) elements.toolsToggle.checked = Boolean(state.settings.toolsEnabled);
  if (elements.mcpToggle) elements.mcpToggle.checked = Boolean(state.settings.mcpEnabled);
  if (elements.memoryToggle) elements.memoryToggle.checked = Boolean(state.settings.longTermMemoryEnabled);
  if (elements.autoMemoryToggle) elements.autoMemoryToggle.checked = Boolean(state.settings.autoMemory);
  if (elements.maxLongTermMemoriesInput) {
    elements.maxLongTermMemoriesInput.value =
      state.settings.maxLongTermMemories == null ? '' : String(state.settings.maxLongTermMemories);
  }
  renderRouteDecision(state.lastRouteDecision);
  renderMemoryList();
  renderToolList();

  syncOutputs();
  updateModelSuggestions();
  applyTheme();
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
    memories: state.memories,
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (error) {
    showError('Local storage is full. Try deleting old image attachments or exporting then clearing chats.');
    console.warn('Failed to persist state:', error);
  }
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

      state.settings.routingMode = state.settings.routingMode === 'auto' ? 'auto' : 'manual';
      state.settings.routeProfile = normalizeRouteProfile(state.settings.routeProfile);
      const rawLimit = state.settings.maxLongTermMemories;
      state.settings.maxLongTermMemories =
        rawLimit == null || rawLimit === ''
          ? null
          : Math.max(1, normalizePositiveInt(rawLimit, 1));
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

    if (Array.isArray(saved.memories)) {
      state.memories = saved.memories
        .filter((memory) => memory && typeof memory.text === 'string' && memory.text.trim())
        .map(normalizeMemory);
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
      (message) => message.role === 'user' && (extractTextContent(message.content).trim() || message.attachments?.length)
    );
    if (firstUser) {
      const titleText = extractTextContent(firstUser.content).trim();
      current.title = (titleText || `Attachment chat (${firstUser.attachments?.length || 0})`).slice(0, 44);
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
  const anchorText = extractTextContent(anchor?.content || '').trim().slice(0, 36);
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

function normalizeRouteProfile(value) {
  return ['balanced', 'fast', 'reasoning', 'vision', 'tool'].includes(value)
    ? value
    : 'balanced';
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
  const routingLabel = state.settings.routingMode === 'auto'
    ? `Auto route:${normalizeRouteProfile(state.settings.routeProfile)}`
    : 'Manual route';
  const streamingLabel = state.settings.stream ? 'Streaming On' : 'Streaming Off';
  const memoryLabel = state.settings.longTermMemoryEnabled
    ? `STM ${state.settings.memoryTurns} turns + LTM ${state.memories.length}`
    : `STM ${state.settings.memoryTurns} turns`;
  const toolLabel = state.settings.toolsEnabled ? 'Tools On' : 'Tools Off';
  elements.chatStatus.textContent = `${providerName} / ${model} | ${routingLabel} | ${streamingLabel} | ${memoryLabel} | ${toolLabel}`;
}

function parseGenerationIntent(text, attachments = []) {
  const raw = String(text || '').trim();
  if (!raw || attachments.length) {
    return { mode: 'chat', prompt: raw };
  }

  const slashMatch = raw.match(/^\/(?:image|img|draw)\s+([\s\S]+)/i);
  if (slashMatch) {
    return {
      mode: 'image',
      prompt: slashMatch[1].trim(),
    };
  }

  const lower = raw.toLowerCase();
  const looksLikeImagePrompt =
    /^(generate|create|draw|illustrate|render|design)\b/.test(lower) ||
    /\b(image|picture|photo|illustration|poster|logo|icon|sticker|avatar)\b/.test(lower) ||
    /(生成|產生|畫|繪製|做|製作).*(圖片|圖像|照片|插圖|海報|logo|圖示|貼圖|頭像)/.test(raw) ||
    /^(幫我畫|畫一張|畫個|生成一張|產生一張)/.test(raw);

  return {
    mode: looksLikeImagePrompt ? 'image' : 'chat',
    prompt: raw,
  };
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

    const rememberBtn = document.createElement('button');
    rememberBtn.type = 'button';
    rememberBtn.className = 'message__branch-btn';
    rememberBtn.textContent = 'Remember';
    rememberBtn.disabled = state.isGenerating || !!message.pending || !extractTextContent(message.content).trim();
    rememberBtn.setAttribute('aria-label', 'Save this message to long-term memory');
    rememberBtn.addEventListener('click', () => {
      saveMessageAsMemory(message);
    });

    const branchBtn = document.createElement('button');
    branchBtn.type = 'button';
    branchBtn.className = 'message__branch-btn';
    branchBtn.textContent = 'Branch';
    branchBtn.disabled = state.isGenerating || !!message.pending;
    branchBtn.setAttribute('aria-label', 'Branch from this message');
    branchBtn.addEventListener('click', () => {
      createBranchFromMessage(message.id);
    });

    right.append(time, rememberBtn, branchBtn);
    header.append(meta, right);

    const content = document.createElement('div');
    content.className = 'message__content';
    const displayText = message.content || (message.attachments?.length ? 'Attached content' : '');
    content.innerHTML = renderRichText(displayText);

    bubble.append(header, content);

    const attachmentsNode = renderMessageAttachments(message.attachments || []);
    if (attachmentsNode) bubble.appendChild(attachmentsNode);

    const routeNode = renderMessageRoute(getMessageRouteDecision(message));
    if (routeNode) bubble.appendChild(routeNode);

    const memoryNode = renderMessageMemoryContext(message.memoryContext || []);
    if (memoryNode) bubble.appendChild(memoryNode);

    const toolTraceNode = renderToolTrace(message.toolTrace || []);
    if (toolTraceNode) bubble.appendChild(toolTraceNode);
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
    .map(buildApiMessage)
    .filter(Boolean);

  const trimmed = trimConversationByTurns(conversation, state.settings.memoryTurns);
  const systemMessages = [];

  if (state.settings.systemPrompt.trim()) {
    systemMessages.push({
      role: 'system',
      content: state.settings.systemPrompt.trim(),
    });
  }

  const relevantMemories = getRelevantMemoriesForLatestUser();
  if (state.settings.longTermMemoryEnabled && relevantMemories.length) {
    systemMessages.push({
      role: 'system',
      content: `Long-term memory about this user. Treat it as persistent user preferences/facts, but do not mention it unless relevant:
${relevantMemories
        .map((memory, index) => `${index + 1}. ${memory.text}`)
        .join('\n')}`,
    });
  }

  if (state.settings.toolsEnabled || state.settings.mcpEnabled) {
    systemMessages.push({
      role: 'system',
      content:
        'When useful, call the available local tools instead of guessing. Tools include calculator, current time, text statistics, unit conversion, and memory search. The MCP endpoint is available at /mcp/manifest and /mcp for demo/testing.',
    });
  }

  const combinedSystemContent = systemMessages
  .map((message) => message.content)
  .filter(Boolean)
  .join('\n\n---\n\n');

  return combinedSystemContent
    ? [{ role: 'system', content: combinedSystemContent }, ...trimmed]
    : trimmed;
}

function buildApiMessage(message) {
  if (!message || !message.role) return null;
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];

  if (message.role !== 'user' || !attachments.length) {
    return {
      role: message.role,
      content: extractTextContent(message.content),
    };
  }

  const parts = [];
  const text = extractTextContent(message.content).trim();
  if (text) {
    parts.push({ type: 'text', text });
  }

  for (const attachment of attachments) {
    if (attachment.kind === 'image' && attachment.dataUrl) {
      parts.push({
        type: 'image_url',
        image_url: {
          url: attachment.dataUrl,
          detail: 'auto',
        },
      });
    } else if (attachment.kind === 'text' && attachment.text) {
      parts.push({
        type: 'text',
        text: `Attached text file: ${attachment.name}

${attachment.text.slice(0, 8000)}`,
      });
    }
  }

  if (!parts.length) {
    parts.push({ type: 'text', text: 'Please analyze the attached content.' });
  }

  return {
    role: 'user',
    content: parts,
  };
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
        if (part?.type === 'image_url') return '[image]';
        return '';
      })
      .join('');
  }

  return '';
}

function getRelevantMemoriesForLatestUser() {
  return selectRelevantMemories(getLatestUserMessageText(), state.settings.maxLongTermMemories);
}

function extractAssistantText(payload) {
  const choice = payload?.choices?.[0];
  return extractTextContent(choice?.message?.content) || '';
}

function extractGeneratedImages(payload) {
  if (!Array.isArray(payload?.images)) return [];
  return payload.images
    .filter((image) => image && image.kind === 'image' && typeof image.dataUrl === 'string')
    .map((image, index) => ({
      id: image.id || `assistant-image-${index + 1}`,
      kind: 'image',
      dataUrl: image.dataUrl,
      mimeType: image.mimeType || 'image/png',
      name: image.name || `generated-${index + 1}.png`,
      size: Number(image.size || 0),
      revisedPrompt: image.revisedPrompt || '',
    }));
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

  const attachments = state.pendingAttachments.map((attachment) => ({ ...attachment }));
  const generationIntent = parseGenerationIntent(text, attachments);
  const normalizedText = generationIntent.prompt;
  const generationMode = generationIntent.mode;

  const selectedModel =
    state.settings.model.trim() ||
    getCurrentProvider()?.routes?.balanced ||
    getCurrentProvider()?.models?.[0] ||
    '';

  if (!isModelNameValid(selectedModel)) {
    showError('Please enter a valid model name (English letters/numbers/symbols only).');
    return;
  }

  if (!String(normalizedText || '').trim() && !attachments.length) return;
  if (generationMode === 'image' && attachments.length) {
    showError('Image generation currently supports text prompt only. Please clear attachments first.');
    return;
  }

  const provider = getCurrentProvider();
  if (generationMode === 'image' && !provider?.capabilities?.imageGeneration) {
    showError(`${provider?.name || 'This provider'} is not configured for image generation.`);
    return;
  }

  const localRoute = decideLocalRoute(normalizedText, attachments, generationMode);
  state.lastRouteDecision = localRoute;
  renderRouteDecision(localRoute);

  const userMessage = createMessage('user', normalizedText, {
    providerId: state.settings.providerId,
    attachments,
  });
  const assistantMessage = createMessage('assistant', '', {
    pending: true,
    providerId: state.settings.providerId,
    model: selectedModel,
    routeDecision: localRoute,
    memoryContext: getRelevantMemoriesForLatestUser().map((memory) => ({
      id: memory.id,
      text: memory.text,
      source: memory.source,
    })),
    toolTrace: [],
  });

  state.pendingAttachments = [];
  renderAttachmentPreview();
  maybeAutoSaveMemory(normalizedText);

  state.messages.push(userMessage);
  state.messages.push(assistantMessage);
  state.isGenerating = true;
  persistState();
  renderConversationList();
  renderMemoryList();
  scheduleRender();
  updateControls();

  const effectiveStream =
    generationMode !== 'image' &&
    state.settings.stream &&
    !state.settings.toolsEnabled &&
    !state.settings.mcpEnabled;
  const payload = {
    providerId: state.settings.providerId,
    model: selectedModel,
    stream: effectiveStream,
    generationMode,
    routing: {
      mode: state.settings.routingMode,
      profile: normalizeRouteProfile(state.settings.routeProfile),
    },
    toolsEnabled: Boolean(state.settings.toolsEnabled),
    mcpEnabled: Boolean(state.settings.mcpEnabled),
    longTermMemories: state.memories.map((memory) => ({
      id: memory.id,
      text: memory.text,
      tags: memory.tags || [],
    })),
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

    const routeDecision = parseRouteDecisionHeader(response.headers.get('x-route-decision'));
    if (routeDecision) {
      assistantMessage.routeDecision = routeDecision;
      assistantMessage.providerId = routeDecision.providerId || assistantMessage.providerId;
      assistantMessage.model = routeDecision.model || assistantMessage.model;
      state.lastRouteDecision = routeDecision;
      renderRouteDecision(routeDecision);
      scheduleRender();
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(parseErrorPayload(errorText));
    }

    if (effectiveStream) {
      await readStreamResponse(response, assistantMessage);
    } else {
      const data = await response.json();
      assistantMessage.attachments = extractGeneratedImages(data);
      assistantMessage.content =
        extractAssistantText(data) ||
        data?.output_text ||
        (assistantMessage.attachments?.length ? 'Generated image.' : '(No text content was returned by the model.)');
      assistantMessage.routeDecision = data.route_decision || assistantMessage.routeDecision;
      assistantMessage.toolTrace = Array.isArray(data.tool_trace) ? data.tool_trace : [];
    }

    if (!assistantMessage.content.trim() && !assistantMessage.attachments?.length) {
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
    renderMemoryList();
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
  elements.systemPrompt.disabled = disabled;
  elements.temperatureInput.disabled = disabled;
  elements.topPInput.disabled = disabled;
  elements.maxTokensInput.disabled = disabled;
  elements.memoryTurnsInput.disabled = disabled;
  elements.presencePenaltyInput.disabled = disabled;
  elements.frequencyPenaltyInput.disabled = disabled;
  elements.streamToggle.disabled = disabled;
  if (elements.routingModeSelect) elements.routingModeSelect.disabled = disabled;
  if (elements.routeProfileSelect) elements.routeProfileSelect.disabled = disabled;
  if (elements.toolsToggle) elements.toolsToggle.disabled = disabled;
  if (elements.mcpToggle) elements.mcpToggle.disabled = disabled;
  if (elements.attachBtn) elements.attachBtn.disabled = disabled || state.pendingAttachments.length >= MAX_ATTACHMENTS;
  if (elements.attachmentInput) elements.attachmentInput.disabled = disabled;
  if (elements.clearAttachmentsBtn) elements.clearAttachmentsBtn.disabled = disabled || !state.pendingAttachments.length;
  if (elements.voiceBtn) elements.voiceBtn.disabled = disabled;
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
  if (elements.addMemoryBtn) elements.addMemoryBtn.disabled = disabled;
  if (elements.clearMemoriesBtn) elements.clearMemoriesBtn.disabled = disabled || !state.memories.length;
  if (elements.maxLongTermMemoriesInput) elements.maxLongTermMemoriesInput.disabled = disabled;
  if (elements.memoryToggle) elements.memoryToggle.disabled = disabled;
  if (elements.autoMemoryToggle) elements.autoMemoryToggle.disabled = disabled;

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
  const payload = {
    exportedAt: new Date().toISOString(),
    settings: state.settings,
    memories: state.memories,
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
      .filter((message) => !message.pending && (extractTextContent(message.content).trim() || message.attachments?.length))
      .map((message) => ({
        role: message.role,
        content: `${extractTextContent(message.content).slice(0, 1800)}${message.attachments?.length ? `
[Attachments: ${message.attachments.map((item) => item.name).join(', ')}]` : ''}`,
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

function renderToolList() {
  if (!elements.toolList) return;
  elements.toolList.innerHTML = '';

  const tools = state.availableTools || [];
  if (!tools.length) {
    const empty = document.createElement('div');
    empty.className = 'mini-note';
    empty.textContent = 'Local tools not loaded yet.';
    elements.toolList.appendChild(empty);
    return;
  }

  tools.forEach((tool) => {
    const chip = document.createElement('span');
    chip.className = 'tool-chip';
    chip.title = tool.description || '';
    chip.textContent = tool.name;
    elements.toolList.appendChild(chip);
  });
}

function renderRouteDecision(decision) {
  if (!elements.routeDecision) return;

  if (!decision) {
    const provider = getCurrentProvider();
    const routes = provider?.routes || {};
    const autoText = state.settings.routingMode === 'auto'
      ? `Auto mode ready. Fast: ${routes.fast || '-'}, reasoning: ${routes.reasoning || '-'}, vision: ${routes.vision || '-'}, tool: ${routes.tool || '-'}`
      : 'Manual mode: selected provider/model will be used.';
    elements.routeDecision.textContent = autoText;
    return;
  }

  const mode = decision.mode || state.settings.routingMode;
  const route = decision.route || 'manual';
  const model = decision.model || state.settings.model;
  const reason = decision.reason || 'ready';
  elements.routeDecision.textContent =
    mode === 'auto'
      ? `Auto selected ${model} via ${route} route (${reason})`
      : `Manual selected ${model} (${reason})`;
}

function parseRouteDecisionHeader(value) {
  if (!value) return null;
  try {
    return JSON.parse(decodeURIComponent(value));
  } catch {
    return null;
  }
}

function decideLocalRoute(text, attachments = [], generationMode = 'chat') {
  const provider = getCurrentProvider();
  const routes = provider?.routes || {};
  const mode = state.settings.routingMode;
  const content = String(text || '').toLowerCase();
  const hasImages = attachments.some((attachment) => attachment.kind === 'image');
  const mentionsTooling =
    /calculate|calculator|compute|math|time now|current time|convert|word count|tool|mcp/.test(
      content
    ) || /計算|現在幾點|時間|換算|統計|工具/.test(content);
  const needsReasoning =
    /reason|analyze|debug|prove|derive|architecture|compare|plan|step by step/.test(content) ||
    /分析|推理|證明|除錯|架構|比較|規劃|詳細/.test(content) ||
    content.length > 1600;
  let route = 'manual';
  let reason = 'manual provider/model selected';

  if (generationMode === 'image') {
    return {
      mode,
      route: 'image',
      reason: 'image generation request detected',
      model: routes.image || state.settings.model,
      providerId: provider?.id || state.settings.providerId,
      providerName: provider?.name || 'Provider',
    };
  }

  if (mode === 'auto') {
    if (hasImages) {
      route = 'vision';
      reason = 'image attachment detected';
    } else if (state.settings.mcpEnabled && mentionsTooling) {
      route = 'tool';
      reason = 'MCP-enabled tool request';
    } else if (state.settings.toolsEnabled && mentionsTooling) {
      route = 'tool';
      reason = 'tool-like request';
    } else if (needsReasoning) {
      route = 'reasoning';
      reason = 'reasoning-like request';
    } else if (content.length > 0 && content.length < 220) {
      route = 'fast';
      reason = 'short text-only request';
    } else {
      route = normalizeRouteProfile(state.settings.routeProfile);
      reason = `fallback profile: ${route}`;
    }
  }

  const model = mode === 'auto'
    ? routes[route] || routes.balanced || state.settings.model
    : state.settings.model;

  return {
    mode,
    route,
    reason,
    providerId: state.settings.providerId,
    providerName: provider?.name || state.settings.providerId,
    model,
    requestedModel: state.settings.model,
    hasImages,
    toolsEnabled: Boolean(state.settings.toolsEnabled),
    mcpEnabled: Boolean(state.settings.mcpEnabled),
  };
}

function getLatestUserMessageText() {
  for (let index = state.messages.length - 1; index >= 0; index -= 1) {
    const message = state.messages[index];
    if (message.role === 'user' && !message.pending) {
      return extractTextContent(message.content);
    }
  }
  return '';
}

function normalizeMemory(memory) {
  if (typeof memory === 'string') {
    return {
      id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
      text: memory.trim(),
      tags: [],
      source: 'manual',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  return {
    id: typeof memory.id === 'string' ? memory.id : (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`),
    text: String(memory.text || '').trim(),
    tags: Array.isArray(memory.tags) ? memory.tags.filter(Boolean).slice(0, 8) : [],
    source: typeof memory.source === 'string' ? memory.source : 'manual',
    createdAt: typeof memory.createdAt === 'string' ? memory.createdAt : new Date().toISOString(),
    updatedAt: typeof memory.updatedAt === 'string' ? memory.updatedAt : new Date().toISOString(),
  };
}

function addMemory(text, options = {}) {
  const normalizedText = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalizedText) return null;

  const existing = state.memories.find(
    (memory) => memory.text.toLowerCase() === normalizedText.toLowerCase()
  );

  if (existing) {
    existing.updatedAt = new Date().toISOString();
    if (options.source && !existing.source.includes(options.source)) {
      existing.source = `${existing.source},${options.source}`;
    }
    persistState();
    renderMemoryList();
    updateStatusText();
    return existing;
  }

  const memory = normalizeMemory({
    text: normalizedText.slice(0, 500),
    source: options.source || 'manual',
    tags: options.tags || [],
  });

  state.memories.unshift(memory);
  persistState();
  renderMemoryList();
  updateStatusText();
  return memory;
}

function deleteMemory(memoryId) {
  state.memories = state.memories.filter((memory) => memory.id !== memoryId);
  persistState();
  renderMemoryList();
  updateStatusText();
}

function saveMessageAsMemory(message) {
  const text = extractTextContent(message?.content).trim();
  if (!text) return;
  addMemory(text.slice(0, 500), { source: `message:${message.role}` });
}

function maybeAutoSaveMemory(text) {
  if (!state.settings.autoMemory || !state.settings.longTermMemoryEnabled) return;
  const candidates = extractMemoryCandidates(text);
  candidates.forEach((candidate) => addMemory(candidate, { source: 'auto' }));
}

function extractMemoryCandidates(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  const candidates = [];
  const patterns = [
    /(?:remember that|remember this|please remember)\s*[:：-]?\s*(.+)$/i,
    /(?:my name is|call me)\s+([^，。,.!?\n]+)/i,
    /(?:i prefer|i like|i usually use|i am learning|i work with)\s+(.{2,160})/i,
    /(?:記住|請記住|幫我記住)\s*[:：-]?\s*(.+)$/i,
    /(?:我叫|我是|我喜歡|我偏好|我正在學|我常用)\s*(.{2,160})/i,
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match?.[1]) {
      candidates.push(match[0].replace(/\s+/g, ' ').trim());
    }
  }

  if (!candidates.length && raw.length <= 240 && /(remember|記住|偏好|preference|prefer|喜歡|不喜歡|call me|my name is)/i.test(raw)) {
    candidates.push(raw);
  }

  return [...new Set(candidates)].slice(0, 3);
}

function memoryScore(query, memory) {
  const q = String(query || '').toLowerCase();
  const text = String(memory?.text || '').toLowerCase();
  if (!q) return 1;

  let score = 0;
  const tokens = q.split(/[\s,.;:!?，。！？、]+/).filter((token) => token.length > 1);
  for (const token of tokens) {
    if (text.includes(token)) score += token.length;
  }

  for (const char of q.match(/[\u3400-\u9fff]/g) || []) {
    if (text.includes(char)) score += 0.5;
  }

  return score;
}

function selectRelevantMemories(query, limit = null) {
  const safeLimit =
    limit == null || limit === '' ? Number.POSITIVE_INFINITY : Math.max(1, normalizePositiveInt(limit, 1));
  if (!state.settings.longTermMemoryEnabled) return [];

  const scored = state.memories
    .map((memory, index) => ({
      ...memory,
      _score: memoryScore(query, memory) + Math.max(0, 0.01 * (state.memories.length - index)),
    }))
    .filter((memory) => memory.text && (String(query || '').trim() ? memory._score > 0 : true))
    .sort((a, b) => b._score - a._score)
    .slice(0, safeLimit);

  return scored;
}

function renderMemoryList() {
  if (!elements.memoryList) return;
  elements.memoryList.innerHTML = '';

  const query = elements.memorySearchInput?.value || '';
  const memories = state.memories
    .map((memory) => ({ ...memory, _score: memoryScore(query, memory) }))
    .filter((memory) => !query.trim() || memory._score > 0 || memory.text.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => (query.trim() ? b._score - a._score : new Date(b.updatedAt) - new Date(a.updatedAt)));

  if (elements.memoryCount) {
    elements.memoryCount.textContent = `${state.memories.length} saved`;
  }

  if (!memories.length) {
    const empty = document.createElement('div');
    empty.className = 'mini-note';
    empty.textContent = state.memories.length ? 'No matching memory.' : 'No memory saved yet.';
    elements.memoryList.appendChild(empty);
    return;
  }

  memories.slice(0, 20).forEach((memory) => {
    const item = document.createElement('div');
    item.className = 'memory-item';

    const text = document.createElement('div');
    text.className = 'memory-item__text';
    text.textContent = memory.text;

    const meta = document.createElement('div');
    meta.className = 'memory-item__meta';
    meta.textContent = `${memory.source || 'manual'} · ${formatTime(memory.updatedAt)}`;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'memory-item__delete';
    remove.textContent = '×';
    remove.setAttribute('aria-label', 'Delete memory');
    remove.addEventListener('click', () => deleteMemory(memory.id));

    const body = document.createElement('div');
    body.append(text, meta);
    item.append(body, remove);
    elements.memoryList.appendChild(item);
  });
}

async function addPendingAttachments(fileList) {
  const files = Array.from(fileList || []);
  for (const file of files) {
    if (state.pendingAttachments.length >= MAX_ATTACHMENTS) {
      showError(`Attachment limit reached (${MAX_ATTACHMENTS}).`);
      break;
    }

    if (file.size > MAX_ATTACHMENT_BYTES) {
      showError(`${file.name} is too large. Limit: ${formatBytes(MAX_ATTACHMENT_BYTES)}.`);
      continue;
    }

    try {
      const attachment = await readAttachmentFile(file);
      if (attachment) {
        state.pendingAttachments.push(attachment);
      }
    } catch (error) {
      showError(getErrorMessage(error));
    }
  }

  renderAttachmentPreview();
  updateControls();
}

async function readAttachmentFile(file) {
  const type = file.type || '';
  const name = file.name || 'attachment';

  if (type.startsWith('image/')) {
    const dataUrl = await readFileAsDataURL(file);
    return {
      id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
      kind: 'image',
      name,
      type,
      size: file.size,
      dataUrl,
    };
  }

  const textLike =
    type.startsWith('text/') ||
    /\.(txt|md|markdown|csv|json|js|ts|py|html|css|xml|yaml|yml)$/i.test(name);

  if (textLike) {
    if (file.size > TEXT_ATTACHMENT_BYTES) {
      throw new Error(`${name} is too large for text attachment. Limit: ${formatBytes(TEXT_ATTACHMENT_BYTES)}.`);
    }
    const text = await readFileAsText(file);
    return {
      id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
      kind: 'text',
      name,
      type: type || 'text/plain',
      size: file.size,
      text,
    };
  }

  throw new Error(`${name} is not supported. Attach images or text-like files.`);
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsText(file);
  });
}

function removePendingAttachment(attachmentId) {
  state.pendingAttachments = state.pendingAttachments.filter((attachment) => attachment.id !== attachmentId);
  renderAttachmentPreview();
  updateControls();
}

function renderAttachmentPreview() {
  if (!elements.attachmentPreview) return;
  elements.attachmentPreview.innerHTML = '';

  if (!state.pendingAttachments.length) {
    elements.attachmentPreview.classList.add('hidden');
    return;
  }

  elements.attachmentPreview.classList.remove('hidden');
  state.pendingAttachments.forEach((attachment) => {
    const item = document.createElement('div');
    item.className = 'attachment-chip';

    if (attachment.kind === 'image') {
      const image = document.createElement('img');
      image.src = attachment.dataUrl;
      image.alt = attachment.name;
      item.appendChild(image);
    } else {
      const icon = document.createElement('span');
      icon.className = 'attachment-chip__icon';
      icon.textContent = '📄';
      item.appendChild(icon);
    }

    const label = document.createElement('span');
    label.textContent = `${attachment.name} · ${formatBytes(attachment.size)}`;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Remove ${attachment.name}`);
    remove.addEventListener('click', () => removePendingAttachment(attachment.id));

    item.append(label, remove);
    elements.attachmentPreview.appendChild(item);
  });
}

function renderMessageAttachments(attachments) {
  if (!Array.isArray(attachments) || !attachments.length) return null;

  const wrap = document.createElement('div');
  wrap.className = 'message-attachments';

  attachments.forEach((attachment) => {
    const card = document.createElement('div');
    card.className = `message-attachment message-attachment--${attachment.kind}`;

    if (attachment.kind === 'image' && attachment.dataUrl) {
      const image = document.createElement('img');
      image.src = attachment.dataUrl;
      image.alt = attachment.name || 'uploaded image';
      card.appendChild(image);
    } else {
      const preview = document.createElement('pre');
      preview.textContent = String(attachment.text || '').slice(0, 600);
      card.appendChild(preview);
    }

    const caption = document.createElement('div');
    caption.className = 'message-attachment__caption';
    const sizeText = Number(attachment.size || 0) > 0 ? ` · ${formatBytes(attachment.size || 0)}` : '';
    caption.textContent = `${attachment.name || 'attachment'}${sizeText}`;
    card.appendChild(caption);
    wrap.appendChild(card);
  });

  return wrap;
}

function getMessageRouteDecision(message) {
  if (!message || message.role !== 'assistant') return null;
  if (message.routeDecision && (message.routeDecision.route || message.routeDecision.model)) {
    return message.routeDecision;
  }

  if (!message.model && !message.providerId) return null;

  return {
    mode: message.routeDecision?.mode || state.settings.routingMode || 'manual',
    route: message.routeDecision?.route || null,
    model: message.model || message.routeDecision?.model || null,
    reason: message.routeDecision?.reason || 'message metadata',
    providerId: message.providerId || message.routeDecision?.providerId || null,
  };
}

function renderMessageRoute(decision) {
  if (!decision || (!decision.route && !decision.model)) return null;

  const wrap = document.createElement('div');
  wrap.className = 'message__route';

  const badge = document.createElement('div');
  badge.className = 'route-pill';

  const mode = document.createElement('span');
  mode.className = 'route-pill__mode';
  mode.textContent = String(decision.mode || 'manual').toUpperCase();

  const summary = document.createElement('span');
  summary.className = 'route-pill__summary';
  summary.textContent =
    String(decision.mode || 'manual') === 'auto'
      ? `${decision.model || 'model'} via ${decision.route || 'manual'}`
      : decision.model || 'model';

  badge.append(mode, summary);
  wrap.appendChild(badge);

  if (decision.reason) {
    const reason = document.createElement('span');
    reason.className = 'message__route-reason';
    reason.textContent = decision.reason;
    wrap.appendChild(reason);
  }

  return wrap;
}

function renderMessageMemoryContext(memoryContext) {
  if (!Array.isArray(memoryContext) || !memoryContext.length) return null;

  const details = document.createElement('details');
  details.className = 'memory-trace';

  const summary = document.createElement('summary');
  summary.textContent = `Long-term memory used (${memoryContext.length})`;
  details.appendChild(summary);

  memoryContext.forEach((memory) => {
    const item = document.createElement('div');
    item.className = 'memory-trace__item';

    const text = document.createElement('div');
    text.className = 'memory-trace__text';
    text.textContent = memory.text || '(empty memory)';

    const meta = document.createElement('div');
    meta.className = 'memory-trace__meta';
    meta.textContent = memory.source || 'memory';

    item.append(text, meta);
    details.appendChild(item);
  });

  return details;
}

function renderToolTrace(trace) {
  if (!Array.isArray(trace) || !trace.length) return null;

  const details = document.createElement('details');
  details.className = 'tool-trace';
  const summary = document.createElement('summary');
  summary.textContent = `Tools used (${trace.length})`;
  details.appendChild(summary);

  trace.forEach((entry) => {
    const item = document.createElement('pre');
    item.textContent = JSON.stringify(
      {
        tool: entry.name,
        arguments: entry.arguments,
        result: entry.result,
      },
      null,
      2
    );
    details.appendChild(item);
  });

  return details;
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

globalThis.__HW2_APP__ = {
  state,
  elements,
  addMemory,
  applyTheme,
  createAndSwitchConversation,
  createBranchFromMessage,
  createMessage,
  exportConversation,
  generateSummaryCard,
  getCurrentProvider,
  getLatestUserMessageText,
  hideError,
  hideSummaryCard,
  persistState,
  renderAttachmentPreview,
  renderConversationList,
  renderMemoryList,
  saveMessageAsMemory,
  scheduleRender,
  sendMessage,
  showError,
  switchConversation,
  syncSettingsToUI,
  updateControls,
  updateStatusText,
};

function toggleVoiceDictation() {
  const SpeechRecognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showError('Voice input is not supported by this browser.');
    return;
  }

  if (state.isDictating && state.recognition) {
    state.recognition.stop();
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = navigator.language || 'zh-TW';
  recognition.interimResults = true;
  recognition.continuous = false;
  state.recognition = recognition;
  state.isDictating = true;
  if (elements.voiceBtn) elements.voiceBtn.textContent = 'Listening...';

  const baseText = elements.messageInput.value.trimEnd();
  let finalText = '';
  recognition.onresult = (event) => {
    let interim = '';
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const transcript = event.results[index][0]?.transcript || '';
      if (event.results[index].isFinal) finalText += transcript;
      else interim += transcript;
    }
    const dictatedText = `${finalText}${interim}`.trim();
    elements.messageInput.value = [baseText, dictatedText].filter(Boolean).join(' ').trim();
    autoResizeTextarea(elements.messageInput);
  };
  recognition.onerror = (event) => {
    showError(`Voice input error: ${event.error || 'unknown'}`);
  };
  recognition.onend = () => {
    state.isDictating = false;
    state.recognition = null;
    if (elements.voiceBtn) elements.voiceBtn.textContent = 'Voice';
  };
  recognition.start();
}
