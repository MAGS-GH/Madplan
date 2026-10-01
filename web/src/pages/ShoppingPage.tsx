import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, toMonday } from '../api'
import type { MealPlan, ShoppingList } from '../types'

export function ShoppingPage() {
  const [lists, setLists] = useState<ShoppingList[]>([])
  const [active, setActive] = useState<ShoppingList | null>(null)
  const [plan, setPlan] = useState<MealPlan | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [amount, setAmount] = useState(1)
  const [unit, setUnit] = useState('stk')

  async function refresh() {
    const [all, ensured] = await Promise.all([
      api.listShoppingLists(),
      api.ensureMealPlan(toMonday(new Date())),
    ])
    setLists(all)
    setPlan(ensured)
    if (active) {
      const updated = all.find((l) => l.id === active.id)
      setActive(updated ?? all[0] ?? null)
    } else {
      setActive(all[0] ?? null)
    }
  }

  useEffect(() => {
    void refresh().catch((e) => setError(e instanceof Error ? e.message : 'Fejl'))
  }, [])

  async function generate() {
    if (!plan) return
    setError(null)
    try {
      const list = await api.createShoppingFromPlan(plan.id)
      setActive(list)
      await refresh()
      setActive(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke generere liste')
    }
  }

  async function toggle(itemId: string, checked: boolean) {
    if (!active) return
    await api.updateShoppingItem(active.id, itemId, { checked })
    const updated = await api.getShoppingList(active.id)
    setActive(updated)
    setLists((prev) => prev.map((l) => (l.id === updated.id ? updated : l)))
  }

  async function addItem() {
    if (!active || !name.trim()) return
    await api.addShoppingItem(active.id, { name: name.trim(), amount, unit })
    setName('')
    const updated = await api.getShoppingList(active.id)
    setActive(updated)
  }

  return (
    <section>
      <div className="panel stack">
        <h2>Indkøb</h2>
        <p className="muted" style={{ margin: 0 }}>
          Generér en liste fra denne uges plan, eller tilføj linjer manuelt.
        </p>
        <div className="row">
          <button className="btn accent" type="button" onClick={() => void generate()} disabled={!plan}>
            Generér fra ugeplan
          </button>
          <Link className="btn secondary" to="/">
            Se ugeplan
          </Link>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      {lists.length > 0 && (
        <div className="panel row">
          <div className="field">
            <label>Vælg liste</label>
            <select
              value={active?.id ?? ''}
              onChange={(e) => setActive(lists.find((l) => l.id === e.target.value) ?? null)}
            >
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title} ({l.items.filter((i) => !i.checked).length} tilbage)
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {active && (
        <div className="panel stack">
          <h3>{active.title}</h3>
          <ul className="list">
            {active.items.map((item) => (
              <li key={item.id}>
                <label className={`checkbox-row ${item.checked ? 'done' : ''}`}>
                  <input
                    type="checkbox"
                    checked={item.checked}
                    onChange={(e) => void toggle(item.id, e.target.checked)}
                  />
                  <span>
                    {item.name}{' '}
                    <span className="muted">
                      {item.amount} {item.unit}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>

          <div className="row">
            <div className="field">
              <label>Ny vare</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Fx mælk" />
            </div>
            <div className="field" style={{ maxWidth: 100 }}>
              <label>Mængde</label>
              <input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
            </div>
            <div className="field" style={{ maxWidth: 90 }}>
              <label>Enhed</label>
              <input value={unit} onChange={(e) => setUnit(e.target.value)} />
            </div>
            <button className="btn" type="button" onClick={() => void addItem()}>
              Tilføj
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
