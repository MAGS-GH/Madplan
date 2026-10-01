import { NavLink, Outlet } from 'react-router-dom'

export function Layout() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <div className="brand">
            Mad<span>plan</span>
          </div>
          <p>Tidslinje for madpakke og aftensmad — planlæg hvad I laver, og hvor mange dage det rækker.</p>
        </div>
      </header>

      <nav className="nav" aria-label="Hovedmenu">
        <NavLink to="/" end>
          Ugeplan
        </NavLink>
        <NavLink to="/retter">Retter</NavLink>
        <NavLink to="/indkoeb">Indkøb</NavLink>
        <NavLink to="/scan">Scan</NavLink>
      </nav>

      <Outlet />
    </div>
  )
}
