import { Suspense, lazy, useEffect } from 'react'
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useGame } from './store/game'
import { Layout } from './components/Layout'
import { Toasts } from './components/ui'
import { Fatal, Login, Setup } from './pages/Login'
import Home from './pages/Home'
import CasePage from './pages/CasePage'
const Inventory = lazy(() => import('./pages/Inventory'))
const Upgrade = lazy(() => import('./pages/Upgrade'))
const Contracts = lazy(() => import('./pages/Contracts'))
const BattleRoom = lazy(() => import('./pages/Battles').then((m) => ({ default: m.BattleRoom })))
const Battles = lazy(() => import('./pages/Battles').then((m) => ({ default: m.Battles })))
const Bonus = lazy(() => import('./pages/More').then((m) => ({ default: m.Bonus })))
const Coinflip = lazy(() => import('./pages/More').then((m) => ({ default: m.Coinflip })))
const Pass = lazy(() => import('./pages/More').then((m) => ({ default: m.Pass })))
const Top = lazy(() => import('./pages/More').then((m) => ({ default: m.Top })))
const Crash = lazy(() => import('./pages/Crash'))
const Fair = lazy(() => import('./pages/Profile').then((m) => ({ default: m.Fair })))
const Profile = lazy(() => import('./pages/Profile').then((m) => ({ default: m.Profile })))
const Gallery = lazy(() => import('./pages/Gallery'))
const Credits = lazy(() => import('./pages/Credits'))

function ScrollTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

export default function App() {
  const phase = useGame((s) => s.phase)
  const error = useGame((s) => s.error)
  useEffect(() => {
    void useGame.getState().boot()
  }, [])
  if (phase === 'boot') return <div className="grid min-h-dvh place-items-center"><div className="display animate-pulse text-4xl font-black gold-text">ЗАЛЁТ</div></div>
  if (phase === 'setup') return <Setup />
  if (phase === 'error') return <Fatal text={error} />
  return (
    <HashRouter>
      <Toasts />
      {phase === 'login' ? <Login /> : (
        <Layout>
          <ScrollTop />
          <Suspense fallback={<div className="space-y-3"><div className="h-24 animate-pulse rounded-3xl bg-white/5" /><div className="h-64 animate-pulse rounded-3xl bg-white/5" /></div>}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/case/:id" element={<CasePage />} />
            <Route path="/inventory" element={<Inventory />} />
            <Route path="/upgrade" element={<Upgrade />} />
            <Route path="/contracts" element={<Contracts />} />
            <Route path="/battles" element={<Battles />} />
            <Route path="/battle/:id" element={<BattleRoom />} />
            <Route path="/coinflip" element={<Coinflip />} />
            <Route path="/crash" element={<Crash />} />
            <Route path="/pass" element={<Pass />} />
            <Route path="/top" element={<Top />} />
            <Route path="/bonus" element={<Bonus />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/profile/:nick" element={<Profile />} />
            <Route path="/fair" element={<Fair />} />
            <Route path="/gallery" element={<Gallery />} />
            <Route path="/credits" element={<Credits />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </Suspense>
        </Layout>
      )}
    </HashRouter>
  )
}
