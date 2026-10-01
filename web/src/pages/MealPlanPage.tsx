import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { addDays, api, formatMacros, toMonday } from '../api'
import type { MealPlan, MealType, Recipe } from '../types'
import { MEAL_LABELS } from '../types'

const MEAL_TYPES: MealType[] = [0, 1, 2, 3]
const DAY_NAMES = ['Man', 'Tir', 'Ons', 'Tor', 'Fre', 'Lør', 'Søn']

export function MealPlanPage() {
  const [weekStart, setWeekStart] = useState(() => toMonday(new Date()))
  const [plan, setPlan] = useState<MealPlan | null>(null)
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState<{ date: string; mealType: MealType } | null>(null)
  const [recipeId, setRecipeId] = useState('')
  const [servings, setServings] = useState(2)

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  )

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [ensured, recipeList] = await Promise.all([
        api.ensureMealPlan(weekStart),
        api.listRecipes(),
      ])
      setPlan(ensured)
      setRecipes(recipeList)
      if (recipeList[0]) setRecipeId(recipeList[0].id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke hente ugeplan')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [weekStart])

  async function addEntry() {
    if (!plan || !recipeId || !adding) return
    try {
      await api.addMealEntry(plan.id, {
        date: adding.date,
        mealType: adding.mealType,
        recipeId,
        servings,
      })
      setAdding(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke tilføje måltid')
    }
  }

  async function removeEntry(entryId: string) {
    if (!plan) return
    await api.removeMealEntry(plan.id, entryId)
    await load()
  }

  function shiftWeek(delta: number) {
    setWeekStart(addDays(weekStart, delta * 7))
  }

  return (
    <section>
      <div className="panel row" style={{ justifyContent: 'space-between' }}>
        <button className="btn secondary" type="button" onClick={() => shiftWeek(-1)}>
          ← Forrige
        </button>
        <div style={{ textAlign: 'center' }}>
          <h2>Uge fra {weekStart}</h2>
          <p className="muted" style={{ margin: 0 }}>
            {loading ? 'Henter…' : `${plan?.entries.length ?? 0} måltider`}
          </p>
        </div>
        <button className="btn secondary" type="button" onClick={() => shiftWeek(1)}>
          Næste →
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {adding && (
        <div className="panel stack">
          <h3>
            Tilføj til {adding.date} · {MEAL_LABELS[adding.mealType]}
          </h3>
          {recipes.length === 0 ? (
            <p>
              Ingen retter endnu. <Link to="/retter/ny">Opret en ret</Link> først.
            </p>
          ) : (
            <div className="row">
              <div className="field">
                <label>Ret</label>
                <select value={recipeId} onChange={(e) => setRecipeId(e.target.value)}>
                  {recipes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.title}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ maxWidth: 120 }}>
                <label>Portioner</label>
                <input
                  type="number"
                  min={0.5}
                  step={0.5}
                  value={servings}
                  onChange={(e) => setServings(Number(e.target.value))}
                />
              </div>
            </div>
          )}
          <div className="row">
            <button className="btn" type="button" disabled={!recipeId} onClick={() => void addEntry()}>
              Gem
            </button>
            <button className="btn ghost" type="button" onClick={() => setAdding(null)}>
              Annuller
            </button>
          </div>
        </div>
      )}

      <div className="day-grid">
        {days.map((date, index) => {
          const entries = plan?.entries.filter((e) => e.date === date) ?? []
          return (
            <article key={date} className="panel day-card">
              <h3>
                {DAY_NAMES[index]}{' '}
                <span className="muted" style={{ fontFamily: 'var(--font-body)', fontSize: '0.9rem' }}>
                  {date.slice(5)}
                </span>
              </h3>
              {MEAL_TYPES.map((mealType) => {
                const slotEntries = entries.filter((e) => e.mealType === mealType)
                return (
                  <div key={mealType} className="meal-slot">
                    <strong>{MEAL_LABELS[mealType]}</strong>
                    {slotEntries.map((entry) => (
                      <div key={entry.id} className="meal-entry">
                        <div>
                          <div>{entry.recipeTitle}</div>
                          <div className="macros">
                            {entry.servings} port.
                            {entry.macros ? ` · ${formatMacros(entry.macros)}` : ''}
                          </div>
                        </div>
                        <button className="btn ghost" type="button" onClick={() => void removeEntry(entry.id)}>
                          Fjern
                        </button>
                      </div>
                    ))}
                    <button
                      className="btn ghost"
                      type="button"
                      onClick={() => {
                        setAdding({ date, mealType })
                        const recipe = recipes.find((r) => r.id === recipeId)
                        if (recipe) setServings(recipe.servings)
                      }}
                    >
                      + Tilføj
                    </button>
                  </div>
                )
              })}
            </article>
          )
        })}
      </div>
    </section>
  )
}
