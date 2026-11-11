/** Модели оружия, ножей и перчаток. Названия свои, силуэты — в src/art/shapes.ts (ключ shape). */
export type ItemKind = 'gun' | 'knife' | 'glove'

export interface Weapon {
  id: string
  name: string
  kind: ItemKind
  shape: string
}

export const WEAPONS: Weapon[] = [
  { id: 'p1', name: 'Шершень', kind: 'gun', shape: 'pistol' },
  { id: 'p2', name: 'Барон', kind: 'gun', shape: 'revolver' },
  { id: 's1', name: 'Стриж', kind: 'gun', shape: 'smg' },
  { id: 's2', name: 'Комар', kind: 'gun', shape: 'pdw' },
  { id: 'sg', name: 'Кувалда', kind: 'gun', shape: 'shotgun' },
  { id: 'r1', name: 'Буран', kind: 'gun', shape: 'rifle' },
  { id: 'r2', name: 'Гранит', kind: 'gun', shape: 'carbine' },
  { id: 'r3', name: 'Рысь', kind: 'gun', shape: 'bullpup' },
  { id: 'sn1', name: 'Жало', kind: 'gun', shape: 'sniper' },
  { id: 'sn2', name: 'Беркут', kind: 'gun', shape: 'dmr' },
  { id: 'mg', name: 'Мамонт', kind: 'gun', shape: 'lmg' },
  { id: 'k1', name: 'Коготь', kind: 'knife', shape: 'claw' },
  { id: 'k2', name: 'Бабочка', kind: 'knife', shape: 'butterfly' },
  { id: 'k3', name: 'Штык', kind: 'knife', shape: 'bayonet' },
  { id: 'k4', name: 'Клык', kind: 'knife', shape: 'dagger' },
  { id: 'k5', name: 'Тесак', kind: 'knife', shape: 'cleaver' },
  { id: 'g1', name: 'Перчатки «Хват»', kind: 'glove', shape: 'glove' },
  { id: 'g2', name: 'Краги «Драйв»', kind: 'glove', shape: 'gauntlet' },
]

export const WEAPON_BY_ID = new Map(WEAPONS.map((w) => [w.id, w]))

/** Какое оружие встречается на какой редкости (индекс = редкость). Особые (6) берутся из KNIVES/GLOVES. */
export const SLOT_WEAPONS: string[][] = [
  ['p1', 's1', 'sg', 'p2', 's2'],
  ['s2', 'r3', 'p2', 'sg', 'mg'],
  ['r2', 'mg', 's1', 'sn2', 'r3'],
  ['r1', 'sn2', 'r3', 'p2', 'r2'],
  ['r2', 'sn1', 'r1', 'sn2'],
  ['sn1', 'r1', 'r2'],
  [],
  ['r1', 'sn1', 'r2', 'p2'],
]

export const KNIVES = ['k1', 'k2', 'k3', 'k4', 'k5']
export const GLOVES = ['g1', 'g2']
