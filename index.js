import {
    DEFAULT_SETTINGS, CHAT_KEY, SETTINGS_KEY, ANCHOR_KEY, RECALL_KEY,
    buildPrompts, extractCharacter, isActive, validMode,
} from './core.js';

const PANEL_ID = 'ci-antisoftening-panel';
const IN_PROMPT = 0;  // after Main Prompt / Story String
const IN_CHAT = 1;    // near the latest chat message
const SYSTEM_ROLE = 0;
const USER_ROLE = 1;  // works with Anthropic chat history where system role is restricted
let extensionDisabled = false;
let panelMounted = false;
let eventsRegistered = false;

function getContext() {
    return globalThis.SillyTavern?.getContext?.() ?? null;
}

function getSettings(context) {
    if (!context?.extensionSettings) return { ...DEFAULT_SETTINGS };
    const saved = context.extensionSettings[SETTINGS_KEY];
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) {
        context.extensionSettings[SETTINGS_KEY] = { ...DEFAULT_SETTINGS };
    } else {
        for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
            if (!(key in saved)) saved[key] = value;
        }
    }
    return context.extensionSettings[SETTINGS_KEY];
}

function getChatOptions(context) {
    const raw = context?.chatMetadata?.[CHAT_KEY];
    return {
        mode: validMode(raw?.mode),
        rules: typeof raw?.rules === 'string' ? raw.rules : '',
    };
}

function setPrompt(context, key, text, position, depth, role) {
    if (typeof context?.setExtensionPrompt !== 'function') return;
    context.setExtensionPrompt(key, text, position, depth, false, role);
}

function clearPrompts(context) {
    setPrompt(context, ANCHOR_KEY, '', IN_PROMPT, 0, SYSTEM_ROLE);
    setPrompt(context, RECALL_KEY, '', IN_CHAT, 0, USER_ROLE);
}

function computed(context) {
    const settings = getSettings(context);
    const chatOptions = getChatOptions(context);
    const character = context ? extractCharacter(context) : null;
    const active = Boolean(character) && isActive(settings, chatOptions);
    const prompts = active ? buildPrompts({
        character, userName: context.name1 || 'User', settings, chatOptions,
    }) : { anchor: '', recall: '' };
    return { settings, chatOptions, character, active, prompts };
}

function refreshPrompts() {
    const context = getContext();
    if (!context) return;
    const { settings, active, prompts } = computed(context);
    if (!active || extensionDisabled) {
        clearPrompts(context);
    } else {
        setPrompt(context, ANCHOR_KEY, prompts.anchor, IN_PROMPT, 0, SYSTEM_ROLE);
        setPrompt(context, RECALL_KEY, settings.recentReminder ? prompts.recall : '',
            IN_CHAT, Math.max(0, Math.min(3, Number(settings.depth) || 0)), USER_ROLE);
    }
    updateStatus();
}

function byId(id) { return document.getElementById(id); }

function updateStatus() {
    const element = byId('ci-status');
    if (!element) return;
    const state = computed(getContext());
    if (!state.character) {
        element.textContent = 'Неактивно: выбери одиночный чат с персонажем (групповые чаты пока не поддерживаются).';
    } else if (!state.active || extensionDisabled) {
        element.textContent = `Выключено для чата «${state.character.name}».`;
    } else {
        element.textContent = `Работает для «${state.character.name}» · сила ${state.settings.strength}/3 · напоминание ${state.settings.recentReminder ? 'включено' : 'отключено'}.`;
    }
}

function syncPanel() {
    if (!byId(PANEL_ID)) return;
    const state = computed(getContext());
    byId('ci-enabled').checked = Boolean(state.settings.enabled);
    byId('ci-strength').value = String(state.settings.strength);
    byId('ci-repeat-card').checked = Boolean(state.settings.repeatCard);
    byId('ci-speech-habits').checked = state.settings.speechHabits !== false;
    byId('ci-decisions').checked = state.settings.decisionIntegrity !== false;
    byId('ci-recall').checked = Boolean(state.settings.recentReminder);
    byId('ci-depth').value = String(state.settings.depth);
    byId('ci-depth').disabled = !state.settings.recentReminder;
    byId('ci-chat-mode').value = state.chatOptions.mode;
    byId('ci-chat-rules').value = state.chatOptions.rules;
    const unavailable = !state.character;
    byId('ci-chat-mode').disabled = unavailable;
    byId('ci-chat-rules').disabled = unavailable;
    byId('ci-save-chat').disabled = unavailable;
    updateStatus();
}

function saveGlobal(change) {
    const ctx = getContext();
    if (!ctx) return;
    Object.assign(getSettings(ctx), change);
    ctx.saveSettingsDebounced?.();
    refreshPrompts();
}

async function saveChatOptions() {
    const ctx = getContext();
    if (!ctx || !extractCharacter(ctx) || !ctx.chatMetadata) return;
    ctx.chatMetadata[CHAT_KEY] = {
        mode: validMode(byId('ci-chat-mode').value),
        rules: byId('ci-chat-rules').value,
    };
    try {
        await ctx.saveMetadata?.();
        refreshPrompts();
        globalThis.toastr?.success?.('Настройки чата сохранены.', 'Character Integrity');
    } catch (error) {
        console.error('[Character Integrity] Cannot save chat metadata', error);
        globalThis.toastr?.error?.('Не удалось сохранить настройки чата.');
    }
}

function showPreview() {
    const ctx = getContext();
    const data = computed(ctx);
    const output = byId('ci-preview');
    if (!output) return;
    if (!data.character) {
        output.value = 'Выбери одиночный чат с персонажем.';
    } else {
        // Show an accurate preview even when disabled, so a user can adjust before enabling.
        const prompts = buildPrompts({ character: data.character, userName: ctx.name1 || 'User',
            settings: data.settings, chatOptions: data.chatOptions });
        output.value = `=== MAIN PROMPT ANCHOR ===\n${prompts.anchor}\n\n=== RECENT REMINDER ===\n${data.settings.recentReminder ? prompts.recall : '(off)'}`;
    }
    output.hidden = false;
}

function mountPanel() {
    if (panelMounted || byId(PANEL_ID)) { panelMounted = true; return; }
    const host = byId('extensions_settings2');
    if (!host) { console.warn('[Character Integrity] Extensions settings container not found'); return; }

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.className = 'inline-drawer';
    panel.innerHTML = `
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>Character Integrity — Card Fidelity</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content ci-stack">
            <div class="ci-hint">Закрепляет <b>все</b> описанные черты и решения персонажа, включая сочетания и условия: цинизм и заботу, вспыльчивость и хладнокровие в опасности, устойчивые привычки речи. Не добавляет черты от себя. Решения персонажа должны исходить из его мотивов, а не из автоматического согласия с игроком. Работает через добавление инструкций в запрос без отдельного API.</div>
            <label class="ci-check"><input id="ci-enabled" type="checkbox" /> Включить по умолчанию</label>
            <div class="ci-row"><label for="ci-strength">Строгость характера</label>
                <select id="ci-strength" class="text_pole">
                    <option value="1">1 — бережно</option><option value="2">2 — сильно</option>
                    <option value="3">3 — максимально строго</option>
                </select></div>
            <label class="ci-check"><input id="ci-repeat-card" type="checkbox" /> Повторять поля карточки, включая примеры диалогов</label>
            <label class="ci-check"><input id="ci-speech-habits" type="checkbox" /> Строго сохранять речевые привычки и ситуативные реакции</label>
            <label class="ci-check"><input id="ci-decisions" type="checkbox" /> <span><b>Character Decision Integrity:</b> сохранять мотивы, моральные границы и логику поступков (не только речь)</span></label>
            <label class="ci-check"><input id="ci-recall" type="checkbox" /> Напоминание перед ответом: профиль и привычки</label>
            <div class="ci-row"><label for="ci-depth">Глубина напоминания (0 = в конце)</label>
                <select id="ci-depth" class="text_pole">
                    <option value="0">0</option><option value="1">1</option>
                    <option value="2">2</option><option value="3">3</option>
                </select></div>
            <hr />
            <strong>Этот чат</strong>
            <div class="ci-row"><label for="ci-chat-mode">Режим чата</label>
                <select id="ci-chat-mode" class="text_pole">
                    <option value="inherit">Как в общих настройках</option>
                    <option value="on">Всегда включено</option><option value="off">Выключено</option>
                </select></div>
            <label for="ci-chat-rules">Особенно важные привычки / принципы / развитие отношений</label>
            <textarea class="text_pole" id="ci-chat-rules" rows="4"
                placeholder="Например: {{char}} превращает реплики {{user}} в двусмысленные шутки; {{char}} добр даже во время ссор; доверие развивается медленно."></textarea>
            <div class="ci-hint">Эти заметки сохраняются для текущего чата, не изменяя карточку.</div>
            <button type="button" id="ci-save-chat" class="menu_button">Сохранить настройки чата</button>
            <span id="ci-status" class="ci-badge" role="status"></span>
            <button type="button" id="ci-show-preview" class="menu_button">Показать текст инструкций</button>
            <textarea id="ci-preview" class="text_pole" rows="10" readonly hidden></textarea>
            <div class="ci-hint">Ограничения модели и правила провайдера расширение не отключает.
                Проверить фактический запрос можно через Prompt Inspector.</div>
        </div>`;
    host.appendChild(panel);
    panelMounted = true;

    byId('ci-enabled').addEventListener('change', event => saveGlobal({ enabled: event.target.checked }));
    byId('ci-strength').addEventListener('change', event => saveGlobal({ strength: Number(event.target.value) }));
    byId('ci-repeat-card').addEventListener('change', event => saveGlobal({ repeatCard: event.target.checked }));
    byId('ci-speech-habits').addEventListener('change', event => saveGlobal({ speechHabits: event.target.checked }));
    byId('ci-decisions').addEventListener('change', event => saveGlobal({ decisionIntegrity: event.target.checked }));
    byId('ci-recall').addEventListener('change', event => {
        saveGlobal({ recentReminder: event.target.checked }); syncPanel();
    });
    byId('ci-depth').addEventListener('change', event => saveGlobal({ depth: Number(event.target.value) }));
    byId('ci-save-chat').addEventListener('click', saveChatOptions);
    byId('ci-show-preview').addEventListener('click', showPreview);
    syncPanel();
}

function registerEvents() {
    const ctx = getContext();
    if (!ctx?.eventSource || eventsRegistered) return;
    eventsRegistered = true;
    const events = ctx.eventTypes ?? ctx.event_types ?? {};
    if (events.APP_INITIALIZED) ctx.eventSource.on(events.APP_INITIALIZED, mountPanel);
    if (events.APP_READY) ctx.eventSource.on(events.APP_READY, () => { mountPanel(); refreshPrompts(); syncPanel(); });
    for (const key of ['CHAT_CHANGED', 'CHAT_CREATED', 'CHARACTER_EDITED', 'CHARACTER_DELETED',
                       'GENERATION_AFTER_COMMANDS', 'MESSAGE_SENT', 'MAIN_API_CHANGED', 'SETTINGS_UPDATED',
                       'PERSONA_CHANGED', 'PRESET_CHANGED', 'CHATCOMPLETION_MODEL_CHANGED']) {
        if (events[key]) ctx.eventSource.on(events[key], refreshPrompts);
    }
    if (events.CHAT_CHANGED) ctx.eventSource.on(events.CHAT_CHANGED, syncPanel);
    // This can run before the UI finishes mounting, but safely prepares the injections.
    refreshPrompts();
    if (document.readyState === 'complete') { mountPanel(); syncPanel(); }
}

/** Clear injections if a user disables this extension from SillyTavern's manager. */
export function onDisable() {
    extensionDisabled = true;
    clearPrompts(getContext());
    updateStatus();
}

export function onEnable() {
    extensionDisabled = false;
    refreshPrompts();
}

registerEvents();
if (!eventsRegistered && typeof window !== 'undefined') {
    window.addEventListener('load', registerEvents, { once: true });
}