import { useState } from 'react'
import { ShieldCheck, Sparkles } from 'lucide-react'
import { LIMITS } from '../config/economy'
import { useGame } from '../store/game'
import { Avatar, Btn, cx } from '../components/ui'

export function Login() {
  const login = useGame((s) => s.login)
  const [nick, setNick] = useState('')
  const [pin, setPin] = useState('')
  const [avatar, setAvatar] = useState(() => Math.floor(Math.random() * LIMITS.avatars))
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    setErr((await login(nick, pin, avatar)) ?? '')
    setBusy(false)
  }
  return (
    <div className="grid min-h-dvh place-items-center p-4">
      <form className="glass w-full max-w-md rounded-3xl p-6 sm:p-8" onSubmit={(e) => { e.preventDefault(); void submit() }}>
        <div className="text-center">
          <div className="display text-4xl font-black gold-text">ЗАЛЁТ</div>
          <p className="mt-2 text-sm text-mute">Кейсы, апгрейды и батлы с друзьями.<br />Валюта игровая — никаких реальных денег.</p>
        </div>
        <label className="mt-6 block text-xs font-bold text-mute">Ник</label>
        <input data-testid="nick" value={nick} onChange={(e) => setNick(e.target.value)} maxLength={LIMITS.nickMax} autoComplete="username" placeholder="Например, Вован"
          className="mt-1 h-12 w-full rounded-xl border border-line bg-white/5 px-4 text-base font-bold outline-none focus:border-gold/60" />
        <label className="mt-4 block text-xs font-bold text-mute">PIN (от {LIMITS.pinMin} символов)</label>
        <input data-testid="pin" value={pin} onChange={(e) => setPin(e.target.value)} type="password" maxLength={32} autoComplete="current-password" placeholder="Придумай и запомни"
          className="mt-1 h-12 w-full rounded-xl border border-line bg-white/5 px-4 text-base font-bold outline-none focus:border-gold/60" />
        <p className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-snug text-mute"><ShieldCheck size={13} className="mt-px shrink-0" />Новый ник — создадим профиль. Если ник твой — введи свой PIN, и зайдёшь с любого устройства.</p>
        <label className="mt-4 block text-xs font-bold text-mute">Аватар</label>
        <div className="mt-2 grid grid-cols-8 gap-2">
          {Array.from({ length: LIMITS.avatars }, (_, i) => (
            <button type="button" key={i} onClick={() => setAvatar(i)} aria-label={'Аватар ' + (i + 1)} className={cx('grid place-items-center rounded-full p-0.5 transition', avatar === i ? 'ring-2 ring-gold scale-110' : 'opacity-60 hover:opacity-100')}>
              <Avatar n={i} size={34} />
            </button>
          ))}
        </div>
        {err && <div data-testid="login-error" className="mt-4 rounded-xl border border-bad/40 bg-bad/10 px-3 py-2 text-sm font-semibold text-bad">{err}</div>}
        <Btn kind="gold" className="mt-5 h-13 w-full text-base" busy={busy} disabled={nick.trim().length < LIMITS.nickMin || pin.length < LIMITS.pinMin} testId="enter">
          <Sparkles size={18} />Залететь
        </Btn>
      </form>
    </div>
  )
}

export function Setup() {
  return (
    <div className="grid min-h-dvh place-items-center p-4">
      <div className="glass w-full max-w-xl rounded-3xl p-6 sm:p-8 text-sm leading-relaxed">
        <div className="display text-3xl font-black gold-text">ЗАЛЁТ</div>
        <h1 className="display mt-3 text-lg font-bold">Осталось подключить сервер</h1>
        <p className="mt-2 text-mute">Игре нужен бесплатный проект Supabase — в нём живут баланс, инвентарь и батлы. Это 5 минут:</p>
        <ol className="mt-3 list-decimal space-y-2 pl-5">
          <li>Создай проект на <b>supabase.com</b> (Free).</li>
          <li><b>SQL Editor</b> → вставь и запусти <code className="text-gold">supabase/schema.sql</code>, затем <code className="text-gold">supabase/seed.sql</code>.</li>
          <li><b>Authentication → Sign In / Providers</b> → включи <b>Allow anonymous sign-ins</b>.</li>
          <li><b>Project Settings → API</b>: скопируй Project URL и anon public key в файл <code className="text-gold">.env</code> (образец — <code>.env.example</code>) или в секреты деплоя.</li>
          <li>Пересобери / перезапусти игру.</li>
        </ol>
        <p className="mt-4 text-xs text-mute">Подробная инструкция — в README.md.</p>
      </div>
    </div>
  )
}

export function Fatal({ text }: { text: string }) {
  return (
    <div className="grid min-h-dvh place-items-center p-4 text-center">
      <div className="glass max-w-md rounded-3xl p-8">
        <div className="display text-3xl font-black gold-text">ЗАЛЁТ</div>
        <p className="mt-4 text-sm font-semibold text-bad" data-testid="fatal">{text}</p>
        <Btn kind="soft" className="mt-5" onClick={() => location.reload()}>Попробовать ещё раз</Btn>
      </div>
    </div>
  )
}
