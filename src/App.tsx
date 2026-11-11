import { useEffect } from 'react'
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useGame } from './store/game'
import { Layout } from './components/Layout'
import { Toasts } from './components/ui'
import { Fatal, Login, Setup } from './pages/Login'
import Home from './pages/Home'
import CasePage from './pages/CasePage'
import Inventory from './pages/Inventory'
import Upgrade from './pages/Upgrade'
import Contracts from './pages/Contracts'
import { BattleRoom, Battles } from './pages/Battles'
import { Bonus, Coinflip, Pass, Top } from './pages/More'
import { Fair, Profile } from './pages/Profile'

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
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/case/:id" element={<CasePage />} />
            <Route path="/inventory" element={<Inventory />} />
            <Route path="/upgrade" element={<Upgrade />} />
            <Route path="/contracts" element={<Contracts />} />
            <Route path="/battles" element={<Battles />} />
            <Route path="/battle/:id" element={<BattleRoom />} />
            <Route path="/coinflip" element={<Coinflip />} />
            <Route path="/pass" element={<Pass />} />
            <Route path="/top" element={<Top />} />
            <Route path="/bonus" element={<Bonus />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/profile/:nick" element={<Profile />} />
            <Route path="/fair" element={<Fair />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      )}
    </HashRouter>
  )
}
