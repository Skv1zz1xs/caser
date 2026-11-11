/* ============================================================================
 *  ЭКОНОМИКА ИГРЫ — ВСЕ ЦИФРЫ ЗДЕСЬ
 * ----------------------------------------------------------------------------
 *  Крути что угодно в этом файле, потом:
 *    npm run simulate   — проверить, что RTP и «вечер» в норме
 *    npm run gen:sql    — пересобрать supabase/seed.sql и залить его в Supabase
 *
 *  Все суммы здесь — в МОНЕТАХ. (Внутри игры хранятся копейки: 1 монета = 100.)
 * ========================================================================== */

/** Копеек в одной монете. Не трогать. */
export const COIN = 100

/* ----------------------------- РЕДКОСТИ ---------------------------------- */
/** chance — шанс в % (стандартный кейс), min/max — стоимость в долях цены кейса ДО масштабирования k. */
export const RARITIES = [
  { id: 'consumer', name: 'Ширпотреб', color: '#9fb2c8', chance: 60, min: 0.08, max: 0.25 },
  { id: 'industrial', name: 'Промышленное', color: '#52a8ff', chance: 22, min: 0.3, max: 0.65 },
  { id: 'milspec', name: 'Армейское', color: '#4c6bff', chance: 10.5, min: 0.8, max: 1.5 },
  { id: 'restricted', name: 'Запрещённое', color: '#9457ff', chance: 4.8, min: 2, max: 4 },
  { id: 'classified', name: 'Засекреченное', color: '#e23df0', chance: 1.85, min: 5, max: 10 },
  { id: 'covert', name: 'Тайное', color: '#ff4655', chance: 0.58, min: 12, max: 28 },
  { id: 'special', name: 'Редкий особый', color: '#ffc93c', chance: 0.22, min: 30, max: 120 },
  { id: 'contraband', name: 'Контрабанда', color: '#ff7a18', chance: 0.05, min: 150, max: 600 },
] as const

export const R = { consumer: 0, industrial: 1, milspec: 2, restricted: 3, classified: 4, covert: 5, special: 6, contraband: 7 } as const

/* ----------------------------- МОДИФИКАТОРЫ ------------------------------ */
/** Износ: float 0–1, пять категорий (max — верхняя граница float категории). */
export const WEAR = [
  { id: 'fn', name: 'С иголочки', short: 'СИ', max: 0.1 },
  { id: 'mw', name: 'Почти новое', short: 'ПН', max: 0.25 },
  { id: 'ft', name: 'Бывалое', short: 'БВ', max: 0.55 },
  { id: 'ww', name: 'Потёртое', short: 'ПТ', max: 0.8 },
  { id: 'bs', name: 'Убитое в хлам', short: 'УХ', max: 1 },
] as const

/** Цена от износа линейно: float 0 → ×topPct%, float 1 → ×bottomPct%. Разница должна делиться на 10. */
export const WEAR_PRICE = { topPct: 120, bottomPct: 80 }

/** «Счётчик» (аналог StatTrak): шанс в % и множитель цены. У ножей и перчаток не бывает. */
export const COUNTER = { chancePct: 10, mult: 1.5, name: 'Счётчик', short: 'СЧ' }

/** Фазы (паттерны) — только у ножей и перчаток. pct — шанс в %, mult — множитель цены. */
export const PHASES = [
  { id: 'base', name: '', pct: 85, mult: 1 },
  { id: 'glint', name: 'Блик', pct: 12, mult: 2.5 },
  { id: 'gem', name: 'Самоцвет', pct: 2.7, mult: 8 },
  { id: 'nova', name: 'Сверхновая', pct: 0.3, mult: 30 },
] as const

/* ----------------------------- ПРОФИЛИ КЕЙСОВ ---------------------------- */
/** chances — шансы редкостей в % (сумма 100), counts — сколько предметов каждой редкости в кейсе. */
export const PROFILES: Record<string, { chances: number[]; counts: number[]; special: ('knife' | 'glove')[] }> = {
  // Обычный кейс — таблица из ТЗ. Особые: перчатки + нож.
  standard: { chances: RARITIES.map((r) => r.chance), counts: [4, 3, 3, 2, 2, 1, 2, 1], special: ['glove', 'knife'] },
  // Ножевой: шанс особого 3 % вместо 0.22 %, но и цена кейса высокая.
  knife: { chances: [0, 0, 55, 27, 11, 3.9, 3, 0.1], counts: [0, 0, 3, 2, 2, 1, 5, 1], special: ['knife', 'knife', 'knife', 'knife', 'knife'] },
  // Перчаточный.
  glove: { chances: [0, 0, 55, 27, 11, 3.9, 3, 0.1], counts: [0, 0, 3, 2, 2, 1, 4, 1], special: ['glove', 'glove', 'glove', 'glove'] },
}

/** Риск-кейсы: исходы заданы вручную. rarity — индекс редкости (для цвета), pct — шанс в %, raw — доля цены кейса до k. */
export const RISK_TABLES: Record<string, { rarity: number; pct: number; raw: number }[]> = {
  // 50/50: половина — мусор, половина — почти икс два.
  r5050: [
    { rarity: 0, pct: 25, raw: 0.06 },
    { rarity: 0, pct: 25, raw: 0.14 },
    { rarity: 3, pct: 25, raw: 1.6 },
    { rarity: 3, pct: 25, raw: 2.0 },
  ],
  // Один процент: один дорогой предмет с шансом 1 %.
  onepct: [
    { rarity: 0, pct: 60, raw: 0.03 },
    { rarity: 1, pct: 39, raw: 0.06 },
    { rarity: 7, pct: 1, raw: 90 },
  ],
  // Всё или ничего: 10 % на икс девять, иначе — пшик.
  allin: [
    { rarity: 0, pct: 90, raw: 0.02 },
    { rarity: 5, pct: 10, raw: 9 },
  ],
  // Русская рулетка: один из шести.
  ruletka: [
    { rarity: 0, pct: 83.3333, raw: 0.04 },
    { rarity: 4, pct: 16.6667, raw: 5.5 },
  ],
}

/** Бесплатный кейс: цены заданы прямо в монетах (без k). Жирный хвост — источник «залётов». */
export const FREE_TABLE: { rarity: number; pct: number; coins: number }[] = [
  { rarity: 0, pct: 30, coins: 10 },
  { rarity: 0, pct: 25, coins: 20 },
  { rarity: 1, pct: 16, coins: 40 },
  { rarity: 1, pct: 10.14, coins: 80 },
  { rarity: 2, pct: 8, coins: 150 },
  { rarity: 2, pct: 5, coins: 300 },
  { rarity: 3, pct: 3.2, coins: 600 },
  { rarity: 4, pct: 1.8, coins: 1500 },
  { rarity: 5, pct: 0.5, coins: 5000 },
  { rarity: 6, pct: 0.15, coins: 25000 },
  { rarity: 7, pct: 0.18, coins: 150000 },
  { rarity: 7, pct: 0.03, coins: 1000000 },
]

/* ----------------------------- КЕЙСЫ: ЦЕНА И RTP ------------------------- */
/** price — цена в монетах, rtp — целевой возврат (0.90–0.95), profile — standard | knife | glove | risk | free. */
export const CASE_ECON: { id: string; price: number; rtp: number; profile: string }[] = [
  // Дешёвые коллекции
  { id: 'meloch', price: 1, rtp: 0.95, profile: 'standard' },
  { id: 'garazh', price: 3, rtp: 0.95, profile: 'standard' },
  { id: 'podval', price: 5, rtp: 0.95, profile: 'standard' },
  { id: 'dvor', price: 8, rtp: 0.95, profile: 'standard' },
  { id: 'rynok', price: 12, rtp: 0.95, profile: 'standard' },
  { id: 'lombard', price: 18, rtp: 0.95, profile: 'standard' },
  { id: 'rayon', price: 24, rtp: 0.95, profile: 'standard' },
  { id: 'arsenal', price: 30, rtp: 0.95, profile: 'standard' },
  // Мемы и игры
  { id: 'obshaga', price: 7, rtp: 0.95, profile: 'standard' },
  { id: 'skibidi', price: 10, rtp: 0.95, profile: 'standard' },
  { id: 'brainrot', price: 15, rtp: 0.95, profile: 'standard' },
  { id: 'dacha', price: 16, rtp: 0.95, profile: 'standard' },
  { id: 'student', price: 20, rtp: 0.95, profile: 'standard' },
  { id: 'kotiki', price: 28, rtp: 0.95, profile: 'standard' },
  { id: 'mine', price: 35, rtp: 0.94, profile: 'standard' },
  { id: 'sigma', price: 40, rtp: 0.94, profile: 'standard' },
  { id: 'kachalka', price: 45, rtp: 0.94, profile: 'standard' },
  { id: 'backrooms', price: 50, rtp: 0.94, profile: 'standard' },
  { id: 'gta', price: 60, rtp: 0.94, profile: 'standard' },
  { id: 'vpiska', price: 65, rtp: 0.94, profile: 'standard' },
  { id: 'dota', price: 80, rtp: 0.94, profile: 'standard' },
  { id: 'anime', price: 90, rtp: 0.94, profile: 'standard' },
  { id: 'session', price: 100, rtp: 0.94, profile: 'standard' },
  { id: 'zona', price: 130, rtp: 0.93, profile: 'standard' },
  { id: 'it', price: 200, rtp: 0.93, profile: 'standard' },
  { id: 'neon', price: 250, rtp: 0.93, profile: 'standard' },
  // Большие коллекции
  { id: 'kosmos', price: 350, rtp: 0.93, profile: 'standard' },
  { id: 'piraty', price: 500, rtp: 0.93, profile: 'standard' },
  { id: 'mafia', price: 750, rtp: 0.92, profile: 'standard' },
  { id: 'drakon', price: 1200, rtp: 0.92, profile: 'standard' },
  { id: 'olimp', price: 2500, rtp: 0.92, profile: 'standard' },
  { id: 'faraon', price: 5000, rtp: 0.92, profile: 'standard' },
  // Ножевые и перчаточные
  { id: 'klinok', price: 300, rtp: 0.92, profile: 'knife' },
  { id: 'hvat', price: 450, rtp: 0.92, profile: 'glove' },
  { id: 'stal', price: 1500, rtp: 0.92, profile: 'knife' },
  { id: 'barhat', price: 2000, rtp: 0.92, profile: 'glove' },
  // Риск
  { id: 'onepct', price: 50, rtp: 0.95, profile: 'risk' },
  { id: 'r5050', price: 100, rtp: 0.95, profile: 'risk' },
  { id: 'allin', price: 250, rtp: 0.95, profile: 'risk' },
  { id: 'ruletka', price: 500, rtp: 0.95, profile: 'risk' },
  // Элита
  { id: 'platina', price: 10_000, rtp: 0.91, profile: 'standard' },
  { id: 'izumrud', price: 25_000, rtp: 0.91, profile: 'standard' },
  { id: 'rubin', price: 50_000, rtp: 0.91, profile: 'standard' },
  { id: 'almaz', price: 100_000, rtp: 0.9, profile: 'standard' },
  { id: 'korona', price: 250_000, rtp: 0.9, profile: 'standard' },
  { id: 'absolut', price: 1_000_000, rtp: 0.9, profile: 'standard' },
  // Новые кейсы
  { id: 'okean', price: 14, rtp: 0.95, profile: 'standard' },
  { id: 'plyazh', price: 22, rtp: 0.95, profile: 'standard' },
  { id: 'newyear', price: 55, rtp: 0.94, profile: 'standard' },
  { id: 'hellow', price: 66, rtp: 0.94, profile: 'standard' },
  { id: 'kino', price: 75, rtp: 0.94, profile: 'standard' },
  { id: 'gorod', price: 110, rtp: 0.93, profile: 'standard' },
  { id: 'laba', price: 150, rtp: 0.93, profile: 'standard' },
  { id: 'westvest', price: 180, rtp: 0.93, profile: 'standard' },
  { id: 'bunker', price: 420, rtp: 0.93, profile: 'standard' },
  { id: 'dzhungli', price: 600, rtp: 0.93, profile: 'standard' },
  { id: 'samurai', price: 900, rtp: 0.92, profile: 'standard' },
  { id: 'rytsar', price: 1_800, rtp: 0.92, profile: 'standard' },
  { id: 'titan', price: 150_000, rtp: 0.9, profile: 'standard' },
  { id: 'bog', price: 500_000, rtp: 0.9, profile: 'standard' },
  // Бесплатный (цены предметов — в FREE_TABLE)
  { id: 'free', price: 0, rtp: 1, profile: 'free' },
]

/* ----------------------------- АПГРЕЙДЕР --------------------------------- */
/** шанс = вложено / цена цели × edgePct%, допустим только в коридоре minPct…maxPct. */
export const UPGRADE = { edgePct: 95, minPct: 1, maxPct: 75, maxItems: 10 }

/* ----------------------------- КОНТРАКТЫ --------------------------------- */
/**
 * 3–10 предметов одной редкости → предмет следующей редкости.
 * Цена результата = сумма вложенного × множитель. Множитель выбирается по «корзинам»:
 * pct — шанс корзины в %, from/to — границы множителя. Среднее ≈ 0.91.
 */
export const CONTRACT = {
  minItems: 3,
  maxItems: 10,
  buckets: [
    { pct: 55, from: 0.4, to: 0.8 },
    { pct: 30, from: 0.8, to: 1.2 },
    { pct: 11, from: 1.2, to: 1.9 },
    { pct: 4, from: 1.9, to: 3.4 },
  ],
}

/* ----------------------------- БАТЛЫ ------------------------------------- */
export const BATTLE = {
  maxRounds: 10,
  /** тайминги синхронной анимации, мс */
  countdownMs: 3000,
  roundMs: 6000,
  endMs: 3500,
  botNames: ['Бот Валера', 'Бот Гена', 'Бот Жорик', 'Бот Люся', 'Бот Толик', 'Бот Зина', 'Бот Аркадий', 'Бот Нюра'],
}

export const BATTLE_FORMATS = [
  { id: '1v1', name: '1 на 1', slots: 2, teams: [0, 1] },
  { id: '1v1v1', name: '1 на 1 на 1', slots: 3, teams: [0, 1, 2] },
  { id: '2v2', name: '2 на 2', slots: 4, teams: [0, 0, 1, 1] },
  { id: '1v1v1v1', name: 'Четверо', slots: 4, teams: [0, 1, 2, 3] },
] as const

export const BATTLE_MODES = [
  { id: 'classic', name: 'Классика', desc: 'Большая сумма забирает всё' },
  { id: 'crazy', name: 'Крейзи', desc: 'Побеждает меньшая сумма' },
  { id: 'terminal', name: 'Терминал', desc: 'Решает только последний кейс' },
  { id: 'shared', name: 'Шерд', desc: 'Банк делится поровну' },
  { id: 'jackpot', name: 'Джекпот', desc: 'Шанс победы = доля от общей суммы' },
] as const

/* ----------------------------- КОИНФЛИП ---------------------------------- */
/** Победитель забирает банк (2 ставки) минус rakePct %. */
export const COINFLIP = { minStake: 10, maxStake: 10_000_000, rakePct: 4, flipMs: 4500 }

/* ----------------------------- БОНУСЫ ------------------------------------ */
export const BONUS = {
  /** стартовый баланс нового игрока */
  startBalance: 1000,
  /** сдвиг «игровых суток» от UTC в часах (3 = сутки и недели меняются в полночь по Москве) */
  dayOffsetHours: 3,
  /** бесплатный кейс: раз в cooldownMin минут */
  freeCase: { cooldownMin: 10 },
  /** ежедневный бонус: rewards[день стрика], стрик сгорает через resetHours */
  daily: { cooldownHours: 20, resetHours: 48, rewards: [1000, 1200, 1500, 2000, 2500, 3000, 5000] },
  /** второй шанс: если баланс + инвентарь < maxNetWorth, раз в cooldownMin минут даём amount */
  secondChance: { amount: 400, cooldownMin: 15, maxNetWorth: 30 },
  /** дождь в чате: раз в everyMin минут банк pot делится между нажавшими, не больше maxShare на игрока */
  rain: { everyMin: 20, durationSec: 90, pot: 1000, maxShare: 500 },
}

/* ----------------------------- БАТЛ-ПАСС --------------------------------- */
type LevelReward = { coins?: number; case?: [string, number] }

export const PASS = {
  seasonId: 's1',
  seasonName: 'Сезон 1 · Первый залёт',
  /** XP за действия */
  xp: { open: 5, upgrade: 8, contract: 12, battle: 20, coinflip: 6 },
  /** XP на уровень N (с 1): base + step × (N − 1) */
  levelXp: { base: 150, step: 30 },
  /** Награды по уровням (40 уровней). case: [id кейса, сколько бесплатных открытий]. */
  rewards: [
    { coins: 100 }, { case: ['sigma', 2] }, { coins: 150 }, { case: ['gta', 2] }, { coins: 300 },
    { case: ['r5050', 1] }, { coins: 200 }, { case: ['dota', 2] }, { coins: 250 }, { coins: 750, case: ['klinok', 1] },
    { coins: 300 }, { case: ['session', 2] }, { coins: 350 }, { case: ['onepct', 5] }, { coins: 1000 },
    { case: ['it', 2] }, { coins: 450 }, { case: ['allin', 1] }, { coins: 500 }, { coins: 2000, case: ['piraty', 2] },
    { coins: 600 }, { case: ['neon', 2] }, { coins: 700 }, { case: ['kosmos', 2] }, { coins: 2500 },
    { case: ['mafia', 1] }, { coins: 900 }, { case: ['ruletka', 1] }, { coins: 1000 }, { coins: 4000, case: ['drakon', 2] },
    { coins: 1250 }, { case: ['stal', 1] }, { coins: 1500 }, { case: ['olimp', 1] }, { coins: 5000 },
    { case: ['barhat', 1] }, { coins: 2000 }, { case: ['faraon', 1] }, { coins: 2500 }, { coins: 12500, case: ['platina', 1] },
  ] as LevelReward[],
}

/* ----------------------------- ЗАДАНИЯ ----------------------------------- */
/**
 * metric — счётчик: opened, sold, spent (монеты), upgrades, upgrade_wins, contracts, battles, battle_wins,
 * free_cases, x10 (дропы от x10), specials (ножи/перчатки), chat, coinflips.
 */
export const QUESTS: { id: string; period: 'day' | 'week'; title: string; metric: string; goal: number; coins: number; xp: number }[] = [
  { id: 'd_open', period: 'day', title: 'Открой 25 кейсов', metric: 'opened', goal: 25, coins: 250, xp: 120 },
  { id: 'd_free', period: 'day', title: 'Забери 3 бесплатных кейса', metric: 'free_cases', goal: 3, coins: 200, xp: 100 },
  { id: 'd_sell', period: 'day', title: 'Продай 20 предметов', metric: 'sold', goal: 20, coins: 150, xp: 80 },
  { id: 'd_upgrade', period: 'day', title: 'Сделай 5 апгрейдов', metric: 'upgrades', goal: 5, coins: 250, xp: 120 },
  { id: 'd_contract', period: 'day', title: 'Подпиши 2 контракта', metric: 'contracts', goal: 2, coins: 250, xp: 120 },
  { id: 'd_battle', period: 'day', title: 'Сыграй 3 батла', metric: 'battles', goal: 3, coins: 300, xp: 150 },
  { id: 'd_x10', period: 'day', title: 'Выбей дроп x10 и выше', metric: 'x10', goal: 1, coins: 500, xp: 200 },
  { id: 'w_open', period: 'week', title: 'Открой 1 000 кейсов', metric: 'opened', goal: 1000, coins: 2500, xp: 600 },
  { id: 'w_spent', period: 'week', title: 'Потрать 250 000 монет', metric: 'spent', goal: 250_000, coins: 4000, xp: 800 },
  { id: 'w_upwin', period: 'week', title: 'Выиграй 15 апгрейдов', metric: 'upgrade_wins', goal: 15, coins: 2500, xp: 600 },
  { id: 'w_contract', period: 'week', title: 'Подпиши 15 контрактов', metric: 'contracts', goal: 15, coins: 2000, xp: 500 },
  { id: 'w_bwin', period: 'week', title: 'Выиграй 10 батлов', metric: 'battle_wins', goal: 10, coins: 3000, xp: 700 },
  { id: 'w_special', period: 'week', title: 'Выбей нож или перчатки', metric: 'specials', goal: 1, coins: 1500, xp: 1000 },
]

/* ----------------------------- ДОСТИЖЕНИЯ -------------------------------- */
/**
 * metric — счётчик за всё время (те же, что в заданиях) или рекорд:
 * best_mult (лучший икс ×100), peak (пик баланса в монетах), streak (макс. стрик дейликов),
 * gems, novas, contrabands, lucky_ups (апгрейды с шансом ≤ 5 %), second_chances, rains, coinflip_wins.
 */
export const ACHIEVEMENTS: { id: string; title: string; desc: string; metric: string; goal: number; coins: number }[] = [
  { id: 'open10', title: 'Первые шаги', desc: 'Открой 10 кейсов', metric: 'opened', goal: 10, coins: 50 },
  { id: 'open100', title: 'Втянулся', desc: 'Открой 100 кейсов', metric: 'opened', goal: 100, coins: 150 },
  { id: 'open1000', title: 'Кейсовый маньяк', desc: 'Открой 1 000 кейсов', metric: 'opened', goal: 1000, coins: 1000 },
  { id: 'open5000', title: 'Живу в кейсах', desc: 'Открой 5 000 кейсов', metric: 'opened', goal: 5000, coins: 5000 },
  { id: 'x10', title: 'Иксанул', desc: 'Выбей дроп x10', metric: 'best_mult', goal: 1000, coins: 150 },
  { id: 'x50', title: 'Залёт', desc: 'Выбей дроп x50', metric: 'best_mult', goal: 5000, coins: 400 },
  { id: 'x100', title: 'Стрельнул', desc: 'Выбей дроп x100', metric: 'best_mult', goal: 10000, coins: 1000 },
  { id: 'x500', title: 'Легенда двора', desc: 'Выбей дроп x500', metric: 'best_mult', goal: 50000, coins: 5000 },
  { id: 'knife1', title: 'Острое чувство', desc: 'Выбей нож или перчатки', metric: 'specials', goal: 1, coins: 300 },
  { id: 'knife10', title: 'Коллекционер', desc: 'Выбей 10 ножей или перчаток', metric: 'specials', goal: 10, coins: 3000 },
  { id: 'gem', title: 'Самоцвет', desc: 'Выбей фазу «Самоцвет»', metric: 'gems', goal: 1, coins: 1500 },
  { id: 'nova', title: 'Сверхновая', desc: 'Выбей фазу «Сверхновая»', metric: 'novas', goal: 1, coins: 10000 },
  { id: 'contra', title: 'Контрабандист', desc: 'Выбей контрабанду', metric: 'contrabands', goal: 1, coins: 2500 },
  { id: 'up10', title: 'Апгрейдер', desc: 'Выиграй 10 апгрейдов', metric: 'upgrade_wins', goal: 10, coins: 250 },
  { id: 'up100', title: 'Мастер апгрейда', desc: 'Выиграй 100 апгрейдов', metric: 'upgrade_wins', goal: 100, coins: 2500 },
  { id: 'lucky', title: 'Один на миллион', desc: 'Выиграй апгрейд с шансом 5 % и ниже', metric: 'lucky_ups', goal: 1, coins: 1250 },
  { id: 'contract10', title: 'Юрист', desc: 'Подпиши 10 контрактов', metric: 'contracts', goal: 10, coins: 250 },
  { id: 'contract50', title: 'Нотариус', desc: 'Подпиши 50 контрактов', metric: 'contracts', goal: 50, coins: 1500 },
  { id: 'bwin1', title: 'Первая кровь', desc: 'Выиграй батл', metric: 'battle_wins', goal: 1, coins: 150 },
  { id: 'bwin25', title: 'Боец', desc: 'Выиграй 25 батлов', metric: 'battle_wins', goal: 25, coins: 1500 },
  { id: 'bwin100', title: 'Чемпион', desc: 'Выиграй 100 батлов', metric: 'battle_wins', goal: 100, coins: 7500 },
  { id: 'peak10k', title: 'Десяточка', desc: 'Накопи 10 000 монет', metric: 'peak', goal: 10_000, coins: 300 },
  { id: 'peak100k', title: 'Сотка', desc: 'Накопи 100 000 монет', metric: 'peak', goal: 100_000, coins: 3000 },
  { id: 'peak1m', title: 'Миллионер', desc: 'Накопи 1 000 000 монет', metric: 'peak', goal: 1_000_000, coins: 30000 },
  { id: 'streak7', title: 'Постоянный клиент', desc: 'Забери дейлик 7 дней подряд', metric: 'streak', goal: 7, coins: 2500 },
  { id: 'phoenix', title: 'Феникс', desc: 'Используй второй шанс 5 раз', metric: 'second_chances', goal: 5, coins: 500 },
  { id: 'rain10', title: 'Промок', desc: 'Попади под дождь 10 раз', metric: 'rains', goal: 10, coins: 750 },
  { id: 'chat50', title: 'Душа компании', desc: 'Напиши 50 сообщений в чат', metric: 'chat', goal: 50, coins: 250 },
  { id: 'flip10', title: 'Орёл', desc: 'Выиграй 10 коинфлипов', metric: 'coinflip_wins', goal: 10, coins: 750 },
]

/* ----------------------------- ПРОМОКОДЫ --------------------------------- */
/**
 * Задаёшь сам. Каждый код игрок вводит один раз. Регистр не важен.
 * На клиент этот список НЕ попадает — он уходит только в seed.sql (не импортируй его в src/).
 */
export const PROMO_CODES: { code: string; coins?: number; case?: [string, number] }[] = [
  { code: 'ЗАЛЁТ', coins: 1000 },
  { code: 'ДРУЗЬЯ', coins: 500, case: ['sigma', 3] },
  { code: 'КЛИНОК', case: ['klinok', 1] },
]

/* ----------------------------- ПРОЧЕЕ ------------------------------------ */
export const LIMITS = { inventory: 3000, chatLen: 200, nickMin: 2, nickMax: 16, pinMin: 4, avatars: 24, openMax: 10 }
