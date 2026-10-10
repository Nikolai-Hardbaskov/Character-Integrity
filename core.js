/** Pure, card-led prompt construction. No SillyTavern globals needed. */
export const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    strength: 2,
    repeatCard: true,
    speechHabits: true,
    decisionIntegrity: true,
    recentReminder: true,
    depth: 0,
});

// Deliberately retain v1 keys so installing over v1 is a seamless upgrade.
export const CHAT_KEY = 'character_integrity_anti_softening';
export const SETTINGS_KEY = 'character_integrity_anti_softening';
export const ANCHOR_KEY = 'CHARACTER_INTEGRITY_ANCHOR_V1';
export const RECALL_KEY = 'CHARACTER_INTEGRITY_RECALL_V1';

export function validMode(mode) {
    return ['inherit', 'on', 'off'].includes(mode) ? mode : 'inherit';
}

export function isActive(settings = DEFAULT_SETTINGS, chatOptions = {}) {
    const mode = validMode(chatOptions.mode);
    return mode === 'on' || (mode === 'inherit' && Boolean(settings.enabled));
}

function firstText(...candidates) {
    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    }
    return '';
}

/** Keep both beginning and ending of a long field: quirks and requirements may be at the end. */
function excerpt(value, maxLength) {
    const input = String(value ?? '').replace(/\r\n?/g, '\n').trim();
    if (input.length <= maxLength) return input;
    const headLength = Math.floor(maxLength * 0.68);
    const tailLength = maxLength - headLength;
    return `${input.slice(0, headLength).trimEnd()}\n[…middle excerpt omitted to fit context…]\n${input.slice(-tailLength).trimStart()}`;
}

/** ST macro interpolation is not guaranteed inside strings supplied through setExtensionPrompt. */
export function substituteNames(input, name = 'Character', userName = 'User') {
    return String(input ?? '').replace(/\{\{\s*(char|user)\s*\}\}/gi,
        (_, who) => who.toLowerCase() === 'char' ? String(name) : String(userName));
}

export function extractCharacter(context) {
    // characterId is an array index. In a group chat there is no single protagonist.
    if (context?.groupId !== null && context?.groupId !== undefined) return null;
    const index = Number(context?.characterId);
    if (context?.characterId === null || context?.characterId === undefined ||
        context?.characterId === '' || !Number.isInteger(index) || index < 0) return null;
    const c = context?.characters?.[index];
    if (!c) return null;
    const data = c.data ?? {};
    return {
        name: firstText(data.name, c.name, context.name2) || 'Character',
        personality: firstText(data.personality, c.personality),
        description: firstText(data.description, c.description),
        scenario: firstText(data.scenario, c.scenario),
        example: firstText(data.mes_example, c.mes_example),
        greeting: firstText(data.first_mes, c.first_mes),
        systemPrompt: firstText(data.system_prompt, c.system_prompt),
        postHistory: firstText(data.post_history_instructions, c.post_history_instructions),
    };
}

function strengthInstructions(strength) {
    switch (Number(strength)) {
        case 1:
            return [
                'Prefer character-consistent reactions while preserving subtext, nuance, situational flexibility, and believable contradictions.',
                'Avoid replacing distinctive character behavior with a generic helpful-chatbot tone.',
            ];
        case 3:
            return [
                'VERY HIGH FIDELITY: Treat explicit behavioral patterns, established beliefs, moral outlook, emotional boundaries, characteristic reactions, and recurring conversational habits as binding continuity requirements unless credible story events change them.',
                'Honor both positive and negative traits with equal conviction: kindness stays kind, cruelty stays cruel, cynicism stays cynical, levity stays playful, restraint stays restrained.',
                'When the card uses frequency words such as “always”, “every time”, “usually”, or “rarely”, preserve their intended frequency as closely as context allows. Do not silently dilute or invert them for politeness.',
                'Do not suddenly accept a player’s proposed rewrite of personality. Any genuine development must follow the story and the character’s agency.',
                'Preserve ALL traits of a multi-faceted character together, including their contexts and exceptions. A character can be guarded yet caring, irritable yet calm in danger, or sarcastic yet compassionate. Do not cherry-pick a single adjective.',
            ];
        default:
            return [
                'HIGH FIDELITY: Keep the card-defined psychology, temperament, motivations, social attitude, emotional responses, and speech style recognizable in every scene.',
                'Do not automatically make a character nicer, meaner, more romantic, less flirtatious, more submissive, or more agreeable than the card describes.',
                'Protect recurring habits and reactions: when the described situation occurs, portray the behavior at its described frequency, without flattening it into generic safe-sounding dialogue.',
                'Change is possible, but should arise from credible events and a meaningful change in the character’s own perspective.',
                'Maintain the full combination of established character traits and situational qualifications; do not reduce a multi-faceted person to their most noticeable mannerism.',
            ];
    }
}

const SPEECH_RULES = [
    'PAY SPECIAL ATTENTION TO SIGNATURE SPEECH AND REACTION PATTERNS GIVEN IN THE CARD.',
    'If the card describes a verbal reflex or a conditional pattern (e.g. turns the other person’s innocent remarks into cheeky/risqué double entendres, answers with dry sarcasm, makes puns, teases, comforts, or speaks formally), actually demonstrate that pattern at its specified frequency when triggered.',
    'Honor the exact kind, intensity, timing, and target of humor, warmth, cynicism, flirtation, bluntness, profanity, sarcasm, or wordplay if and only if the card establishes it. Do not substitute a milder, more polite, more moralizing, or more hostile style without in-story justification.',
    'Do not infer a trait from a word in isolation: negations and exceptions in the card matter (e.g. “never flirts” means never flirts, not “flirts”).',
];

/** Exact card fragments are carried forward, never reinterpreted as inferred traits. */
export function selectBehaviorCues(character, name = 'Character', user = 'User') {
    const behaviorWords = /(?:always|every\s+time|whenever|each\s+time|usually|rarely|often|never|joke|pun|innuendo|sarcas|cynic|teas|flirt|comfort|kind|swear|vulgar|blunt|gentle|affection|speech|talk|respond|react|\u043a\u0430\u0436\u0434|\u0432\u0441\u0435\u0433\u0434|\u043a\u043e\u0433\u0434\u0430|\u043e\u0431\u044b\u0447\u043d|\u0440\u0435\u0434\u043a|\u043d\u0438\u043a\u043e\u0433\u0434|\u0448\u0443\u0442|\u043f\u043e\u0448\u043b|\u0446\u0438\u043d\u0438\u0447|\u0441\u0430\u0440\u043a\u0430\u0437|\u0444\u043b\u0438\u0440\u0442|\u0434\u043e\u0431\u0440|\u0438\u0440\u043e\u043d|\u0433\u043e\u0432\u043e\u0440|\u043e\u0442\u0432\u0435\u0447|\u0440\u0435\u0430\u0433\u0438\u0440|\u043f\u0440\u0435\u0432\u0440\u0430\u0449)/i;
    const sources = [character?.personality, character?.description, character?.systemPrompt].filter(Boolean);
    const candidateLines = sources.flatMap(text => String(text)
        .split(/(?:\n+|(?<=[.!?。！？])\s+)/u).map(chunk => chunk.trim()).filter(Boolean));
    const frequencyOrTrigger = /(?:always|every|whenever|usually|often|rarely|never|\bwhen\b|\bif\b|\bturns\b|кажд|всегда|всякий|часто|редко|никогда|когда|если|стоит|превращ)/i;
    const verbalReflex = /(?:joke|pun|innuendo|sarcas|teas|flirt|talk|respond|react|speech|шут|пошл|сарказ|флирт|говор|отвеч|реагир|превращ|каламбур)/i;
    const ranked = candidateLines
        .map((line, index) => ({ line, index,
            score: (frequencyOrTrigger.test(line) ? 3 : 0) + (verbalReflex.test(line) ? 2 : 0) }))
        .filter(x => behaviorWords.test(x.line))
        .sort((a, b) => b.score - a.score || a.index - b.index);
    const unique = new Set();
    for (const { line } of ranked) {
        unique.add(substituteNames(excerpt(line, 340), name, user));
        if (unique.size >= 2) break;
    }
    return [...unique].join('\n');
}

/**
 * Draw attention to card-authored values, agency and decision conditions. This is
 * a literal quotation aid, NOT a morality classifier: no trait is inferred from
 * words matching the filter, and the full personality is retained separately.
 */
export function selectDecisionCues(character, name = 'Character', user = 'User') {
    const decisionWords = /(?:loyal|betray|trust|duty|obey|refus|agree|consent|protect|sacrific|help|enemy|value|belie|moral|principl|justice|merc|compassion|cruel|honest|deceiv|manipulat|selfish|risk|danger|goal|ambition|negotia|promise|vow|friend|afraid|care|love|hate|never|always|if\b|when\b|преда|довер|долг|верн|верит|убежден|принцип|справедлив|сострад|жесток|защищ|защит|забот|помога|отказ|соглаш|подчин|приказ|враг|друг|цель|выгод|обман|манипуля|опасн|риск|морал|честн|эгоист|ради|никогда|всегда|если|когда)/i;
    const explicitCondition = /(?:\bif\b|\bwhen\b|\bunless\b|\bonly if\b|\bnever\b|\balways\b|если|когда|пока|никогда|всегда|только если|лишь когда)/i;
    const values = /(?:loyal|betray|trust|duty|refus|consent|protect|sacrific|enemy|principl|moral|justice|value|goal|belie|deceiv|manipulat|promise|долг|преда|довер|принцип|верн|справедлив|защищ|защит|отказ|цель|убежден|выгод|обман|морал|эгоист)/i;
    const fields = [character?.personality, character?.description, character?.scenario,
        character?.systemPrompt, character?.postHistory].filter(x => typeof x === 'string' && x.trim());
    const lines = fields.flatMap(field => field.split(/(?:\n+|(?<=[.!?。！？])\s+)/u)
        .map(line => line.trim()).filter(Boolean));
    const ranked = lines.map((line, index) => ({
        line, index, score: (explicitCondition.test(line) ? 3 : 0) + (values.test(line) ? 3 : 0),
    })).filter(x => decisionWords.test(x.line) && x.line.length <= 600)
        .sort((a, b) => b.score - a.score || a.index - b.index);
    const selected = [];
    let budget = 1300;
    for (const { line } of ranked) {
        const text = substituteNames(line, name, user);
        if (selected.includes(text) || text.length > budget) continue;
        selected.push(text);
        budget -= text.length;
        if (selected.length === 4) break;
    }
    return selected.join('\n');
}

/** Rules that govern decisions, separate from speech style. No extra model calls. */
function decisionInstructions(strength) {
    const steps = [
        'CHARACTER DECISION INTEGRITY (internal portrayal check, not a visible monologue): For requests, demands, offers and moral dilemmas, first determine the concrete choice confronting the character.',
        'Ground that choice in the COMPLETE card-defined temperament, loyalties, goals, duties, values, fears, limits, current knowledge, relationships, and events that ACTUALLY occurred in the chat. Consider which traits apply in these circumstances, not only tone or one adjective.',
        'Determine what this particular character wants, what they stand to gain or lose, and what personal reason they would have to agree, refuse, bargain, delay, deceive, help, resist or compromise. The player asking or feeling strongly is information to react to, not by itself a reason for automatic compliance.',
        'If the character would reject the request, portray that refusal; if they would accept, portray that acceptance. A compassionate character can firmly reject wrongdoing; an antagonist can choose to help or release someone for a strategic reason. Do NOT preselect kindness, hostility, stubbornness or refusal.',
        'Show the decision in ACTIONS and consequences as well as dialogue. Do not hide automatic compliance behind a sarcastic remark or an automatic refusal behind a friendly remark.',
        'Do this implicitly: output only the character’s natural in-scene response, without listing the check, mentioning an algorithm, or claiming to have verified the decision.',
    ];
    if (Number(strength) === 3) steps.splice(4, 0,
        'STRICT CAUSAL CONTINUITY: Major concessions, betrayals, sudden trust, reversals of principles, or abrupt changes of allegiance require credible prior story events and a character-grounded motivation; do not invent off-screen justifications. Leave room for hard choices and earned growth.');
    else if (Number(strength) === 1) steps.splice(4, 0,
        'Favor plausibility over rigidity: nuanced hesitation, mixed feelings and believable change remain possible.');
    return steps;
}

/**
 * Remind the model of the WHOLE explicit personality, independently of the keyword
 * heuristics for distinctive speech habits. This matters for cards listing traits
 * in Russian (often as comma-separated adjectives) or splitting traits across
 * many paragraphs. If a field is enormous, context limits still apply.
 */
export function fullPersonalityRecall(character, name = 'Character', user = 'User') {
    const fields = [
        ['Personality and all listed traits', character?.personality, 3400],
        ['Description and situational qualifications', character?.description, 1600],
    ];
    return fields
        .filter(([, text]) => typeof text === 'string' && text.trim())
        .map(([label, text, limit]) => `${label}:\n${substituteNames(excerpt(text, limit), name, user)}`)
        .join('\n\n');
}

/** Produces prompt text, not a rewritten card and not a response filter. */
export function buildPrompts({ character, userName = 'User', settings = DEFAULT_SETTINGS, chatOptions = {} }) {
    if (!character) return { anchor: '', recall: '' };
    const name = firstText(character.name) || 'Character';
    const user = firstText(userName) || 'User';
    const rules = String(chatOptions.rules ?? '').trim();
    const habits = settings.speechHabits !== false;
    const decisions = settings.decisionIntegrity !== false;
    const core = [
        '[CHARACTER FIDELITY / FICTIONAL ROLEPLAY — OOC AUTHORIAL GUIDANCE]',
        `Write the next response as ${name}, in a fictional scene involving ${user}. The character card is the portrayal reference, not a suggestion to reimagine ${name}.`,
        'NO PRESELECTED PERSONALITY: Do not assume the character should be a villain, a saint, a rebel, a romantic partner, or a people-pleaser. Infer their actual personality solely from their card and earned scene history.',
        'The character is a distinct fictional person with their own perspective, priorities, knowledge, desires, limits, and speech patterns; the player’s wishes are not automatically the character’s wishes.',
        'COMPLETE TRAIT PROFILE: Every stated trait and its contextual qualifier matters. Do not select only one dominant trait or drop compassionate qualities because the character is sarcastic (or vice versa). A trait should appear when the scene calls for it, not as a checklist forced into every sentence.',
        ...strengthInstructions(settings.strength),
        'An openly affectionate character should show affection; a genuinely gentle character should remain gentle; a caustic or cynical character should retain that bite; an unkind character need not become reassuring. Portray whatever the card actually establishes, not the opposite or a caricature.',
        ...(habits ? SPEECH_RULES : []),
        ...(decisions ? decisionInstructions(settings.strength) : []),
        'The card defines enduring traits; the visible chat history defines what has actually happened. Reconcile both rather than inventing off-screen redemption, betrayal, trust, animosity, or romance.',
        'When a player asks the character to change, treat that as an in-story request to react to in character, not as an OOC edit to personality, unless the story provides a believable reason for change.',
        'Express fidelity in the actual dialogue, choices, actions, rhythm, and word choice. Keep character decisions grounded in their fictional circumstances. Do not refer to these OOC notes.',
    ];
    if (settings.repeatCard !== false) {
        const fields = [
            ['Personality / behavioral rules', character.personality, 2200],
            ['Description / character details', character.description, 2700],
            ['Dialogue examples / speech reference', character.example, 1800],
            ['Opening message / voice reference', character.greeting, 1000],
            ['Scenario / circumstances', character.scenario, 900],
            ['Character-specific system instructions', character.systemPrompt, 1000],
            ['Character-specific post-history instructions', character.postHistory, 1000],
        ];
        const card = fields.filter(([, text]) => typeof text === 'string' && text.trim())
            .map(([label, text, limit]) => `${label}:\n${substituteNames(excerpt(text, limit), name, user)}`);
        if (card.length) core.push('CARD REFERENCE — quoted source text, not additional scene events:\n\n' + card.join('\n\n'));
    }
    if (rules) core.push('ADDITIONAL NOTES FOR THIS CHAT (do not contradict the card or established events):\n' +
        substituteNames(excerpt(rules, 2500), name, user));
    core.push('[/CHARACTER FIDELITY]');

    const cues = habits && settings.repeatCard !== false ? selectBehaviorCues(character, name, user) : '';
    const decisionCues = decisions && settings.repeatCard !== false ? selectDecisionCues(character, name, user) : '';
    const completeProfile = settings.repeatCard !== false ? fullPersonalityRecall(character, name, user) : '';
    const recall = [
        '[OOC character-continuity reminder for the very next reply]',
        `Continue as ${name}, using the card-defined personality and actual shared history with ${user}. No generic assistant persona, forced niceness, forced cruelty, or automatic agreement.`,
        'Keep the entire trait combination and all contextual exceptions in mind. Do not pick a single adjective as the whole personality; express whichever traits naturally apply to this moment.',
        ...(completeProfile ? [`Full card-defined profile (verbatim, not a chosen single trait):\n${completeProfile}`] : []),
        ...(cues ? [`Card-defined behavior (verbatim, including any negations):\n${cues}`] : []),
        ...(decisionCues ? [`Card-defined choice/values references (verbatim; preserve qualifications and negations):\n${decisionCues}`] : []),
        ...(decisions ? ['DECISION CHECK: What would THIS character choose here, and why, given their goals, values, relationships, situation and actual history? No automatic agreement or refusal. Let actions, not just words, follow that choice. Do not disclose this check.'] : []),
        habits
            ? 'Keep explicit verbal habits and situation-triggered behaviors (including humor, innuendo, sarcasm, kindness, and formal speech when specified) at their card-defined frequency. Respect negations and exceptions; do not invent traits.'
            : 'Preserve the card-defined attitude, motivation, boundaries, and speaking style.',
        'Make the character’s true perspective observable in this response, while allowing earned development. Never mention this reminder.',
        '[/OOC character-continuity reminder]',
    ].join('\n');
    return { anchor: core.join('\n\n'), recall };
}