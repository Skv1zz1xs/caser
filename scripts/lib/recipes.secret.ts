/* ⚠️⚠️⚠️  СПОЙЛЕРЫ  ⚠️⚠️⚠️
 *
 * Здесь лежат секретные рецепты контрактов. Если хочешь находить их сам — закрой файл.
 * Описание человеческим языком — в SECRETS.md (тоже спойлер).
 * На клиент этот файл не попадает: он уходит только в supabase/seed.sql (в закодированном виде).
 *
 *
 *
 *
 *
 *
 *
 *
 *
 *
 *
 *
 *
 *
 *
 *
 *
 *
 *
 *
 */
export interface Recipe {
  id: string
  /** показывается игроку только после того, как рецепт сработал */
  name: string
  minItems: number
  cond:
    | { type: 'cases_each'; cases: string[] }
    | { type: 'same_case'; rarityMin: number }
    | { type: 'all_st' }
    | { type: 'all_wears' }
    | { type: 'weapon_all'; weapon: string }
    | { type: 'same_item' }
    | { type: 'all_wear'; idx: number }
  /** шанс особого исхода, в десятитысячных (2000 = 20 %) */
  chance: number
  /** редкость особого исхода: 6 — нож/перчатки, 7 — контрабанда */
  target: number
  /** множитель суммы вложенного для особого исхода, промилле */
  from: number
  to: number
  /** перезарядка рецепта для игрока, минут */
  cooldownMin: number
}

export const RECIPES: Recipe[] = [
  { id: 'stud', name: 'Студенческий набор', minItems: 3, cond: { type: 'cases_each', cases: ['obshaga', 'student', 'session'] }, chance: 2000, target: 6, from: 2500, to: 4500, cooldownMin: 20 },
  { id: 'counter', name: 'Полный счётчик', minItems: 5, cond: { type: 'all_st' }, chance: 1500, target: 6, from: 3000, to: 5000, cooldownMin: 20 },
  { id: 'rainbow', name: 'Радуга износа', minItems: 5, cond: { type: 'all_wears' }, chance: 1500, target: 6, from: 3000, to: 5500, cooldownMin: 20 },
  { id: 'barons', name: 'Клуб баронов', minItems: 4, cond: { type: 'weapon_all', weapon: 'p2' }, chance: 2500, target: 6, from: 2000, to: 4000, cooldownMin: 20 },
  { id: 'mono', name: 'Одна коробка', minItems: 10, cond: { type: 'same_case', rarityMin: 3 }, chance: 1000, target: 7, from: 5000, to: 9000, cooldownMin: 30 },
  { id: 'twins', name: 'Близнецы', minItems: 3, cond: { type: 'same_item' }, chance: 3000, target: 6, from: 2500, to: 4500, cooldownMin: 20 },
  { id: 'mint', name: 'Всё с иголочки', minItems: 4, cond: { type: 'all_wear', idx: 0 }, chance: 2500, target: 6, from: 3000, to: 5000, cooldownMin: 20 },
  { id: 'rust', name: 'Мусорный ход', minItems: 5, cond: { type: 'all_wear', idx: 4 }, chance: 2500, target: 6, from: 3500, to: 6000, cooldownMin: 20 },
]
