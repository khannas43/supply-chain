import { NavLink, Outlet } from 'react-router-dom'
import { ROLE_LABEL } from '../auth/roles'
import { IDENTITIES } from '../auth/users'
import { useAuth } from '../auth/AuthContext'
import { SCREENS } from '../screens/registry'
import { useApp } from './AppContext'
import { EvidenceDrawer } from './EvidenceDrawer'

export function Shell() {
  const { mode, user, setUserId, signOut, canView } = useAuth()
  const { commodity, setCommodity } = useApp()
  const visible = SCREENS.filter((s) => canView(s.id))

  return (
    <div className="shell">
      <nav className="nav" aria-label="Main">
        <div className="brand">Supply Chain Risk</div>
        {(['Product', 'Support'] as const).map((g) => {
          const items = visible.filter((s) => s.group === g)
          if (!items.length) return null
          return (
            <div key={g} style={{ display: 'contents' }}>
              {g === 'Support' && <h3 className="group">Support</h3>}
              {items.map((s) => (
                <NavLink key={s.id} to={s.path} className={({ isActive }) => (isActive ? 'active' : '')}>
                  <span className="code">{s.id}</span>
                  {s.label}
                </NavLink>
              ))}
            </div>
          )
        })}
      </nav>
      <div className="main">
        <header className="topbar">
          <div className="seg" role="group" aria-label="Commodity">
            {(['wheat', 'tungsten'] as const).filter((c) => !user.scope || user.scope.includes(c)).map((c) => (
              <button key={c} aria-pressed={commodity === c} onClick={() => setCommodity(c)}>
                {c[0].toUpperCase() + c.slice(1)}
              </button>
            ))}
          </div>
          <span className="spacer" />
          {mode === 'dev' ? (
            <label className="devrole">
              Signed in as (dev switch)
              <select value={user.id} onChange={(e) => setUserId(e.target.value)}>
                {IDENTITIES.map((i) => (
                  <option key={i.id} value={i.id}>{i.name} ({ROLE_LABEL[i.role]}{i.scope ? `, ${i.scope.join(', ')} only` : ''})</option>
                ))}
              </select>
            </label>
          ) : (
            <div className="devrole">
              <span><strong>{user.name}</strong> · {user.roles.map((r) => ROLE_LABEL[r]).join(', ')}{user.scope ? ` · ${user.scope.join(', ')} only` : ''}</span>
              <button className="btn" onClick={signOut}>Sign out</button>
            </div>
          )}
        </header>
        <Outlet />
      </div>
      <EvidenceDrawer />
    </div>
  )
}
