import test from 'node:test';
import assert from 'node:assert/strict';
import { ANCHOR_KEY, RECALL_KEY, CHAT_KEY, SETTINGS_KEY } from '../core.js';

test('injects for current solo character, switches without leaking, and clears on disable', async () => {
    const events = new Map();
    const injections = new Map();
    const names = {
        CHAT_CHANGED: 'CHAT_CHANGED', CHAT_CREATED: 'CHAT_CREATED',
        CHARACTER_EDITED: 'CHARACTER_EDITED', CHARACTER_DELETED: 'CHARACTER_DELETED',
        GENERATION_AFTER_COMMANDS: 'GENERATION_AFTER_COMMANDS', MESSAGE_SENT: 'MESSAGE_SENT',
        MAIN_API_CHANGED: 'MAIN_API_CHANGED', APP_READY: 'APP_READY',
        APP_INITIALIZED: 'APP_INITIALIZED', SETTINGS_UPDATED: 'SETTINGS_UPDATED',
    };
    const state = {
        groupId: null, characterId: 0, name1: 'Player',
        characters: [
            { name: 'Vesper', personality: 'Cynical dark lord.' },
            { name: 'Iris', personality: 'Friendly neighbor.' },
        ],
        chatMetadata: {}, extensionSettings: { [SETTINGS_KEY]: { enabled: true, strength: 2, repeatCard: true, recentReminder: true, depth: 0 } },
        eventTypes: names, eventSource: { on: (event, cb) => events.set(event, [...(events.get(event) ?? []), cb]) },
        setExtensionPrompt: (key, text, position, depth, scan, role) => injections.set(key, { text, position, depth, scan, role }),
        saveSettingsDebounced: () => {},
    };
    globalThis.SillyTavern = { getContext: () => state };
    globalThis.document = { readyState: 'loading', getElementById: () => null };
    const module = await import('../index.js');
    assert.match(injections.get(ANCHOR_KEY).text, /Cynical dark lord/);
    assert.equal(state.extensionSettings[SETTINGS_KEY].speechHabits, true, 'v1 settings get new default');
    assert.equal(state.extensionSettings[SETTINGS_KEY].decisionIntegrity, true, 'v2.1 settings get decision default');
    assert.match(injections.get(ANCHOR_KEY).text, /CHARACTER DECISION INTEGRITY/);
    assert.equal(injections.get(ANCHOR_KEY).position, 0);
    assert.equal(injections.get(RECALL_KEY).position, 1);
    assert.equal(injections.get(RECALL_KEY).role, 1);

    state.characterId = 1;
    state.chatMetadata = {};
    for (const handler of events.get('CHAT_CHANGED') ?? []) handler();
    assert.match(injections.get(ANCHOR_KEY).text, /Friendly neighbor/);
    assert.doesNotMatch(injections.get(RECALL_KEY).text, /Cynical dark lord/);
    assert.doesNotMatch(injections.get(ANCHOR_KEY).text, /Cynical dark lord/);

    state.chatMetadata[CHAT_KEY] = { mode: 'off' };
    for (const handler of events.get('GENERATION_AFTER_COMMANDS') ?? []) handler();
    assert.equal(injections.get(ANCHOR_KEY).text, '');
    assert.equal(injections.get(RECALL_KEY).text, '');

    state.chatMetadata[CHAT_KEY] = { mode: 'on' };
    for (const handler of events.get('GENERATION_AFTER_COMMANDS') ?? []) handler();
    assert.ok(injections.get(ANCHOR_KEY).text.length > 0);
    module.onDisable();
    assert.equal(injections.get(ANCHOR_KEY).text, '');
    assert.equal(injections.get(RECALL_KEY).text, '');
    for (const handler of events.get('CHAT_CHANGED') ?? []) handler();
    assert.equal(injections.get(ANCHOR_KEY).text, '', 'events must not re-enable a manually disabled extension');
    module.onEnable();
    assert.match(injections.get(ANCHOR_KEY).text, /Friendly neighbor/);
    assert.doesNotMatch(injections.get(RECALL_KEY).text, /Cynical dark lord/);
    delete globalThis.SillyTavern;
    delete globalThis.document;
});
