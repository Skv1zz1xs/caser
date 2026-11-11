import { useState, type CSSProperties } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { FileSignature, Plus, Sparkles } from 'lucide-react'
import { CONTRACT, RARITIES } from '../config/economy'
import { contractCheck, CONTRACT_MAX_PM, CONTRACT_MIN_PM } from '../shared/contract'
import { rpc, type Item, type Me } from '../lib/api'
import { applyMe, useGame } from '../store/game'
import { dropSound, sfx } from '../audio/sfx'
import { Picker } from '../components/Picker'
import { Btn, Confetti, ItemArt, ItemCard, Money, RarityName, Section, cx, rc } from '../components/ui'
import { useItems } from './Inventory'

interface Res { item: Item; mult: number; value: number; sum: number; secret: null | { name: string; cooling: boolean; hit?: boolean; left?: number }; removed: number[]; me: Me }

export default function Contracts() {
  const { items } = useItems()
  const me = useGame((s) => s.me)!
  const run = useGame((s) => s.run)
  const [sel, setSel] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<Res | null>(null)
  const [confetti, setConfetti] = useState(0)

  const picked = items.filter((i) => sel.has(i.id))
  const rarity = picked[0]?.rarity ?? null
  const sum = picked.reduce((a, i) => a + i.price, 0)
  const check = picked.length ? contractCheck(picked) : null
  const finds = me.claims.filter((c) => c.startsWith('find:')).map((c) => c.slice(5))

  const toggle = (i: Item) => {
    if (busy) return
    sfx('click')
    setRes(null)
    setSel((s) => {
      const n = new Set(s)
      if (n.has(i.id)) n.delete(i.id)
      else if (n.size < CONTRACT.maxItems) n.add(i.id)
      return n
    })
  }
  /** Подбирает набор, который пройдёт проверку: сначала самые дешёвые предметы низшей редкости, потом самые дорогие. */
  const autoFill = () => {
    const rarities = [...new Set(items.filter((i) => i.rarity < 7).map((i) => i.rarity))].sort((x, y) => (rarity !== null ? (x === rarity ? -1 : y === rarity ? 1 : x - y) : x - y))
    for (const r of rarities) {
      const pool = items.filter((i) => i.rarity === r)
      if (pool.length < CONTRACT.minItems) continue
      const asc = [...pool].sort((a, b) => a.price - b.price)
      const desc = [...asc].reverse()
      for (const list of [asc, desc])
        for (let n = CONTRACT.minItems; n <= Math.min(CONTRACT.maxItems, list.length); n++) {
          const pick = list.slice(0, n)
          if (contractCheck(pick).ok) {
            setRes(null)
            setSel(new Set(pick.map((i) => i.id)))
            return
          }
        }
    }
    useGame.getState().toast('Не нашёл подходящий набор: нужно от 3 предметов одной редкости', 'info')
  }
  const sign = async () => {
    if (!check?.ok || busy) return
    setBusy(true)
    sfx('open')
    const r = await run(() => rpc<Res>('contract', { p_ids: [...sel] }))
    if (!r) return setBusy(false)
    await new Promise((ok) => setTimeout(ok, 1300))
    applyMe(r)
    useGame.getState().removeItems(r.removed)
    useGame.getState().addItems([r.item])
    setSel(new Set())
    setRes(r)
    setBusy(false)
    dropSound(r.item.rarity, r.item.phase)
    if (r.secret && !r.secret.cooling) {
      setConfetti(Date.now())
      useGame.getState().toast(`Секретный рецепт «${r.secret.name}»! ${r.secret.hit ? 'И он сработал!' : 'В этот раз без джекпота.'}`, 'gold')
    } else if (r.secret?.cooling) {
      useGame.getState().toast(`Рецепт «${r.secret.name}» остывает — ещё ${Math.ceil((r.secret.left ?? 0) / 60)} мин.`, 'info')
    } else if (r.mult >= 1200) setConfetti(Date.now())
  }

  return (
    <div className="space-y-4">
      <Confetti fire={confetti} />
      <div>
        <h1 className="display text-xl sm:text-2xl font-extrabold">Контракты</h1>
        <p className="text-xs text-mute">{CONTRACT.minItems}–{CONTRACT.maxItems} предметов одной редкости → один предмет следующей. Цена результата — от ×{CONTRACT_MIN_PM / 1000} до ×{CONTRACT_MAX_PM / 1000} от суммы вложенного.</p>
      </div>

      <Section className="!p-4">
        <div className="grid gap-4 md:grid-cols-[1.4fr_1fr] md:items-center">
          <div>
            <div className="grid grid-cols-5 gap-2" data-testid="contract-slots">
              {Array.from({ length: CONTRACT.maxItems }, (_, k) => {
                const i = picked[k]
                return (
                  <motion.button key={k} onClick={() => i && toggle(i)} animate={busy && i ? { scale: [1, 0.6, 0], opacity: [1, 1, 0], y: [0, -10, 40] } : { scale: 1, opacity: 1, y: 0 }}
                    transition={{ duration: 1.1, delay: busy ? k * 0.05 : 0 }}
                    className={cx('aspect-square rounded-2xl grid place-items-center', i ? 'item-card' : 'border border-dashed border-white/15 bg-black/20 text-white/20')}
                    style={i ? ({ '--rc': rc(i.rarity) } as CSSProperties) : undefined}>
                    {i ? <ItemArt i={i} className="h-[70%] w-[90%]" /> : <Plus size={18} />}
                  </motion.button>
                )
              })}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-mute">Вложено: <Money v={sum} className="font-extrabold text-white" /> · {picked.length} шт.</span>
              <button onClick={autoFill} className="text-xs font-bold text-gold" data-testid="autofill">Заполнить дешёвыми</button>
            </div>
          </div>
          <div className="rounded-2xl bg-black/25 p-4 text-center">
            <AnimatePresence mode="wait">
              {res ? (
                <motion.div key="res" initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} data-testid="contract-result">
                  <div className="mb-2 text-xs text-mute">Множитель <b className={res.mult >= 1000 ? 'text-ok' : 'text-bad'}>×{(res.mult / 1000).toFixed(2)}</b></div>
                  <div className="mx-auto max-w-44"><ItemCard i={res.item} /></div>
                </motion.div>
              ) : (
                <motion.div key="info" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-2">
                  <FileSignature className="mx-auto text-gold" size={30} />
                  {rarity !== null && rarity < 7 ? (
                    <>
                      <div className="text-sm"><RarityName r={rarity} /> → <RarityName r={rarity + 1} /></div>
                      <div className="text-xs text-mute">Результат: от <Money v={Math.floor((sum * CONTRACT_MIN_PM) / 1000)} size={11} /> до <Money v={Math.floor((sum * CONTRACT_MAX_PM) / 1000)} size={11} /></div>
                    </>
                  ) : (
                    <div className="text-xs text-mute">Выбери предметы — покажу, что получится</div>
                  )}
                  {check && !check.ok && <div className="text-xs font-semibold text-bad" data-testid="contract-error">{check.error}</div>}
                </motion.div>
              )}
            </AnimatePresence>
            <Btn kind="gold" className="mt-3 h-12 w-full" disabled={!check?.ok} busy={busy} onClick={sign} testId="contract-go"><Sparkles size={16} />Подписать контракт</Btn>
          </div>
        </div>
      </Section>

      {finds.length > 0 && (
        <Section title="Мои находки">
          <div className="flex flex-wrap gap-2">{finds.map((f) => <span key={f} className="rounded-full border border-gold/40 bg-gold/10 px-3 py-1 text-xs font-bold text-gold">✦ {f}</span>)}</div>
        </Section>
      )}

      <Section title="Мои предметы" right={<span className="text-xs text-mute">{rarity !== null ? <>только <RarityName r={rarity} /></> : `редкостей: ${RARITIES.length}`}</span>}>
        <Picker items={items.filter((i) => i.rarity < 7)} selected={sel} onToggle={toggle} lockRarity={rarity} canPick={(i) => sel.size < CONTRACT.maxItems && (rarity === null || i.rarity === rarity)} />
      </Section>
    </div>
  )
}
