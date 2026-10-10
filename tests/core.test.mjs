import test from 'node:test';
import assert from 'node:assert/strict';
import { extractCharacter, buildPrompts, isActive, DEFAULT_SETTINGS, selectBehaviorCues, fullPersonalityRecall, substituteNames } from '../core.js';
const villain = { name: 'Vesper', personality: 'Contemptuous, values power and control.', description: 'A calculating antagonist.', scenario: 'The alliance is broken.', example: '' };
const kind = { name: 'Mira', personality: 'Always kind, supportive and gentle; never uses rude jokes.', description: 'Thoughtful, loyal and caring.' };
const joker = { name: 'Балагур', personality: 'Каждую реплику {{user}} превращает в пошлую шутку, но никогда не насмехается над бедой.', example: '{{user}}: Ты снова занят?\n{{char}}: Да, но для тебя могу сделать исключение.' };

test('recognizes a V2 character including example, greeting and card-authored instructions', () => {
    const actual = extractCharacter({ characterId: 0, groupId: null, characters: [{ data: {...villain, first_mes: 'Hello', system_prompt: 'Always dry', post_history_instructions: 'Never ooc'} }] });
    assert.equal(actual.name, 'Vesper');
    assert.equal(actual.greeting, 'Hello');
    assert.equal(actual.systemPrompt, 'Always dry');
    assert.equal(actual.postHistory, 'Never ooc');
});
test('does not apply blindly to group chat or empty selections', () => {
    assert.equal(extractCharacter({ characterId: 0, groupId: 'a', characters: [villain] }), null);
    assert.equal(extractCharacter({ characterId: undefined, characters: [] }), null);
});
test('per-chat override wins over global default', () => {
    assert.equal(isActive({enabled:false}, {mode:'on'}), true);
    assert.equal(isActive({enabled:true}, {mode:'off'}), false);
    assert.equal(isActive({enabled:true}, {mode:'inherit'}), true);
});
test('universal card fidelity never preselects a villain or kind personality', () => {
    for (const char of [villain, kind, joker]) {
        const p = buildPrompts({ character: char, userName: 'Player', settings: { ...DEFAULT_SETTINGS, strength: 3 } });
        assert.match(p.anchor, /NO PRESELECTED PERSONALITY/);
        assert.match(p.anchor, /perspective/);
        assert.match(p.recall, /continuity reminder/);
    }
    const p = buildPrompts({ character: kind, settings: { ...DEFAULT_SETTINGS, strength: 3 } });
    assert.match(p.anchor, /Always kind, supportive and gentle; never uses rude jokes/);
    assert.match(p.recall, /Always kind, supportive and gentle; never uses rude jokes/);
    assert.match(p.anchor, /kindness stays kind/);
});
test('recurring obscene joke habit from card is quoted verbatim with correct substituted names', () => {
    const p = buildPrompts({character: joker, userName:'Аня'});
    assert.match(p.anchor, /Каждую реплику Аня превращает в пошлую шутку/);
    assert.match(p.recall, /Каждую реплику Аня превращает в пошлую шутку/);
    assert.match(p.anchor, /Аня: Ты снова занят/);
    assert.match(p.anchor, /Балагур: Да, но для тебя/);
    assert.doesNotMatch(p.anchor, /\{\{(?:char|user)\}\}/);
});
test('negations are preserved in salience quotes (never means never)', () => {
    assert.match(selectBehaviorCues(kind), /never uses rude jokes/);
    assert.match(substituteNames('{{char}} talks to {{user}}', 'Ash', 'Lea'), /Ash talks to Lea/);
});
test('gentle tier and disabled excerpts do not force a behavior', () => {
    const p = buildPrompts({ character: kind, settings: { ...DEFAULT_SETTINGS, strength: 1, repeatCard: false, speechHabits: false } });
    assert.doesNotMatch(p.anchor, /CARD REFERENCE/);
    assert.doesNotMatch(p.recall, /Card-defined behavior/);
    assert.doesNotMatch(p.anchor, /PAY SPECIAL ATTENTION/);
    assert.match(p.anchor, /NO PRESELECTED PERSONALITY/);
});
test('long fields keep beginning and end; chat-specific overrides remain bounded', () => {
    const char = { name: 'R', personality: 'Start rule. '+ 'x'.repeat(6000) + ' Never laughs at grief.' };
    const p = buildPrompts({ character: char, chatOptions: {rules: 'r'.repeat(18000)} });
    assert.match(p.anchor, /Never laughs at grief/);
    assert.match(p.anchor, /middle excerpt omitted/);
    assert.ok(p.anchor.length < 10000, `unexpected length: ${p.anchor.length}`);
});
test('explicit recurring speech trigger outranks incidental style mentions in the reminder', () => {
    const character = { name: 'Noir', personality: 'Добрый и заботливый. Ироничный в тяжёлые дни. Каждое высказывание {{user}} превращает в каламбур.' };
    const lines = selectBehaviorCues(character, 'Noir', 'Ника');
    assert.match(lines, /Каждое высказывание Ника превращает в каламбур/);
    assert.ok(lines.startsWith('Каждое'), `highest priority should be recurring speech rule: ${lines}`);
});


test('multifaceted personality retains ALL listed traits, not only salient speech habits', () => {
    const list = [
        'вспыльчивый (темперамент)',
        'хладнокровный (сохраняет контроль в опасности)',
        'спокойный в критических ситуациях',
        'саркастичный', 'язвительный', 'ироничный', 'самоуверенный', 'дерзкий',
        'смелый', 'решительный', 'упрямый', 'настойчивый', 'сострадательный',
        'самоотверженный', 'справедливый', 'принципиальный', 'сдержанный',
        'дистанцированный', 'альтруистичный', 'заботливый', 'защитнический',
    ];
    const character = {
        name: 'Архетип',
        personality: list.join('\n'),
        description: 'Предан товарищам. Уязвимость редко показывает посторонним.',
    };
    const prompts = buildPrompts({ character, userName: 'Игрок', settings: { ...DEFAULT_SETTINGS, strength: 3 } });
    for (const trait of list) {
        assert.ok(prompts.recall.includes(trait), `missing trait in recall: ${trait}`);
    }
    assert.match(prompts.recall, /Предан товарищам/);
    assert.match(prompts.anchor, /COMPLETE TRAIT PROFILE/);
    assert.match(prompts.recall, /entire trait combination/);
    assert.ok(prompts.recall.length < 7200, `recall excessive: ${prompts.recall.length}`);
});

test('multi-paragraph card with no behavior keywords is carried in recall', () => {
    const c = { name: 'A', personality: 'Философский.\nТерпеливый.\nЛюбит порядок.\nСправедливый.' };
    const profile = fullPersonalityRecall(c);
    assert.match(profile, /Философский/);
    assert.match(profile, /Терпеливый/);
    assert.match(profile, /Любит порядок/);
    assert.match(profile, /Справедливый/);
    const prompts = buildPrompts({ character: c, settings: { ...DEFAULT_SETTINGS, speechHabits: false } });
    assert.match(prompts.recall, /Философский/);
});

// v2.2 decision-motivation consistency regressions: these assert constructed
// instructions, not model behavior (a live Claude call is a separate test).
test('decision module requires character-grounded actions, without forcing refusal or agreement', async () => {
    const { selectDecisionCues } = await import('../core.js');
    const villain = {
        name: 'Лорд',
        personality: 'Жестокий, гордый. Не отпускает захваченных врагов без выгоды. Может освободить пленника, если тот полезен его планам.',
        description: 'Главная цель — власть. {{char}} никогда не подчиняется приказам {{user}}.',
    };
    const kind = {
        name: 'Мира',
        personality: 'Добрая, принципиальная, сострадательная. Никогда не предаст доверие друга без серьёзной причины.',
        scenario: '{{char}} защищает НПС, даже если {{user}} просит обратного.',
    };
    const v = buildPrompts({ character: villain, userName: 'Игрок', settings: { ...DEFAULT_SETTINGS, strength: 3 } });
    const k = buildPrompts({ character: kind, userName: 'Игрок', settings: { ...DEFAULT_SETTINGS, strength: 3 } });
    for (const p of [v, k]) {
        assert.match(p.anchor, /CHARACTER DECISION INTEGRITY/);
        assert.match(p.anchor, /reason for automatic compliance/iu);
        assert.match(p.anchor, /A compassionate character can firmly reject wrongdoing/);
        assert.match(p.anchor, /an antagonist can choose to help or release someone/);
        assert.match(p.anchor, /actions and consequences/iu);
        assert.match(p.recall, /DECISION CHECK/);
        assert.match(p.recall, /No automatic agreement or refusal/);
    }
    assert.match(v.recall, /Не отпускает захваченных врагов без выгоды/);
    assert.match(v.recall, /никогда не подчиняется приказам Игрок/);
    assert.match(k.recall, /Никогда не предаст доверие друга без серьёзной причины/);
    assert.match(k.anchor, /Мира защищает НПС/);
    assert.match(selectDecisionCues(kind, 'Мира', 'Игрок'), /Никогда не предаст доверие друга/);
});

test('decision check is independently switchable, old card and speech features remain', () => {
    const character = {
        name: 'Артур',
        personality: 'Осторожный, принципиальный, саркастичный. Никогда не подставляет друзей ради выгоды.',
    };
    const disabled = buildPrompts({
        character,
        settings: { ...DEFAULT_SETTINGS, decisionIntegrity: false },
    });
    assert.doesNotMatch(disabled.anchor, /CHARACTER DECISION INTEGRITY/);
    assert.doesNotMatch(disabled.recall, /DECISION CHECK|Card-defined choice\/values references/);
    assert.match(disabled.anchor, /COMPLETE TRAIT PROFILE/);
    assert.match(disabled.recall, /Осторожный, принципиальный, саркастичный/);
    assert.match(disabled.anchor, /PAY SPECIAL ATTENTION TO SIGNATURE SPEECH/);
});

test('choice references are bounded, keep whole conditional sentences and do not invent traits', async () => {
    const { selectDecisionCues } = await import('../core.js');
    const character = {
        name: 'X',
        personality: [
            'Никогда не предаёт товарищей.',
            'Может солгать врагам, когда требуется спасти союзника.',
            'Предательство не свойственно ему.',
            'Нейтральная фраза без ценностей.',
            'Не отказывается помогать близким людям.',
            'Обдумывает выгоды рисковых сделок.',
            'Цель: защищать мирных жителей.',
            'Ровно такой характер, как описано выше.',
            'Обещания сдерживает даже под угрозой.',
        ].join('\n'),
    };
    const decisionCues = selectDecisionCues(character);
    assert.match(decisionCues, /Никогда не предаёт товарищей/);
    assert.match(decisionCues, /Может солгать врагам, когда требуется спасти союзника/);
    assert.doesNotMatch(decisionCues, /Нейтральная фраза/);
    assert.ok(decisionCues.split('\n').length <= 4);
    assert.ok(decisionCues.length <= 1304);
    const p = buildPrompts({ character });
    assert.match(p.recall, /Цель: защищать мирных жителей/); // Full card profile, not just cues
});
