import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { addDays, api, formatMacros, toMonday } from '../api'
import type { MealPlan, MealPlanEntry, MealType, Recipe } from '../types'
import { MEAL_LABELS, MEAL_TYPES } from '../types'

const DAY_NAMES = ['Man', 'Tir', 'Ons', 'Tor', 'Fre', 'Lør', 'Søn']

function coversDate(entry: MealPlanEntry, date: string): boolean {
  const days = Math.max(1, entry.days ?? 1)
  const end = addDays(entry.date, days - 1)
  return date >= entry.date && date <= end
}

function dayOffset(entry: MealPlanEntry, date: string): number {
  const start = new Date(entry.date + 'T12:00:00')
  const current = new Date(date + 'T12:00:00')
  return Math.round((current.getTime() - start.getTime()) / 86400000) + 1
}

function formatShortDate(iso: string) {
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('da-DK', { weekday: 'short', day: 'numeric', month: 'numeric' })
}

export function MealPlanPage() {
  const [weekStart, setWeekStart] = useState(() => toMonday(new Date()))
  const [plan, setPlan] = useState<MealPlan | null>(null)
  const [prevEntries, setPrevEntries] = useState<MealPlanEntry[]>([])
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState<{ date: string; mealType: MealType } | null>(null)
  const [recipeId, setRecipeId] = useState('')
  const [servings, setServings] = useState(2)
  const [days, setDays] = useState(1)

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  )

  const allEntries = useMemo(() => {
    const current = plan?.entries ?? []
    const byId = new Map<string, MealPlanEntry>()
    for (const e of [...prevEntries, ...current]) byId.set(e.id, e)
    return [...byId.values()]
  }, [plan, prevEntries])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const prevWeek = addDays(weekStart, -7)
      const [ensured, prevPlans, recipeList] = await Promise.all([
        api.ensureMealPlan(weekStart),
        api.getMealPlans(prevWeek),
        api.listRecipes(),
      ])
      setPlan(ensured)
      setPrevEntries(prevPlans[0]?.entries ?? [])
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
        days,
      })
      setAdding(null)
      setDays(1)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke tilføje måltid')
    }
  }

  async function removeEntry(entryId: string) {
    if (!plan) return
    const owned = plan.entries.some((e) => e.id === entryId)
    if (!owned) {
      setError('Retten er sat i forrige uge — skift uge for at fjerne den.')
      return
    }
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
            {loading ? 'Henter…' : 'Madpakke & aftensmad'}
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
              <div className="field" style={{ maxWidth: 120 }}>
                <label>Dage</label>
                <input
                  type="number"
                  min={1}
                  max={14}
                  value={days}
                  onChange={(e) => setDays(Math.max(1, Number(e.target.value) || 1))}
                />
              </div>
            </div>
          )}
          {days > 1 && (
            <p className="muted" style={{ margin: 0 }}>
              Vises også {days === 2 ? addDays(adding.date, 1) : `${addDays(adding.date, 1)} … ${addDays(adding.date, days - 1)}`}
            </p>
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
        {weekDays.map((date, index) => {
          const dayEntries = allEntries.filter((e) => coversDate(e, date))
          return (
            <article key={date} className="panel day-card">
              <h3>
                {DAY_NAMES[index]}{' '}
                <span className="muted" style={{ fontFamily: 'var(--font-body)', fontSize: '0.9rem' }}>
                  {date.slice(5)}
                </span>
              </h3>
              {MEAL_TYPES.map((mealType) => {
                const slotEntries = dayEntries.filter((e) => e.mealType === mealType)
                return (
                  <div key={mealType} className="meal-slot">
                    <strong>{MEAL_LABELS[mealType]}</strong>
                    {slotEntries.map((entry) => {
                      const offset = dayOffset(entry, date)
                      const totalDays = Math.max(1, entry.days ?? 1)
                      const isOrigin = entry.date === date
                      const owned = plan?.entries.some((e) => e.id === entry.id)
                      return (
                        <div key={`${entry.id}-${date}`} className="meal-entry">
                          <div>
                            <div>{entry.recipeTitle}</div>
                            <div className="macros">
                              {entry.servings} port.
                              {entry.macros ? ` · ${formatMacros(entry.macros)}` : ''}
                            </div>
                            {totalDays > 1 && (
                              <div className="muted" style={{ fontSize: '0.82rem' }}>
                                {isOrigin
                                  ? `${totalDays} dage`
                                  : `Fra ${formatShortDate(entry.date)} · dag ${offset}/${totalDays}`}
                              </div>
                            )}
                          </div>
                          {owned && isOrigin && (
                            <button className="btn ghost" type="button" onClick={() => void removeEntry(entry.id)}>
                              Fjern
                            </button>
                          )}
                        </div>
                      )
                    })}
                    <button
                      className="btn ghost"
                      type="button"
                      onClick={() => {
                        setAdding({ date, mealType })
                        setDays(1)
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
