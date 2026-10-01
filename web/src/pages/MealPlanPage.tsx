import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { addDays, api, formatMacros, toMonday } from '../api'
import type { MealPlan, MealPlanEntry, MealType, Recipe } from '../types'
import { MEAL_LABELS, MEAL_TYPES } from '../types'

const DAY_NAMES = ['Man', 'Tir', 'Ons', 'Tor', 'Fre', 'Lør', 'Søn']

/** Madpakke kun man–tor (index 0–3). */
function allowsMadpakke(dayIndex: number): boolean {
  return dayIndex >= 0 && dayIndex <= 3
}

function dayIndexInWeek(weekStart: string, date: string): number {
  return Math.round(
    (new Date(date + 'T12:00:00').getTime() - new Date(weekStart + 'T12:00:00').getTime()) / 86400000,
  )
}

function maxMadpakkeDaysFrom(weekStart: string, date: string): number {
  const idx = dayIndexInWeek(weekStart, date)
  if (!allowsMadpakke(idx)) return 0
  return 4 - idx
}

function entryEnd(entry: MealPlanEntry): string {
  return addDays(entry.date, Math.max(1, entry.days ?? 1) - 1)
}

function overlapsRange(entry: MealPlanEntry, from: string, to: string): boolean {
  return entry.date <= to && entryEnd(entry) >= from
}

function clampSpanInWeek(
  entry: MealPlanEntry,
  weekStart: string,
): { row: number; span: number } | null {
  const weekEnd = addDays(weekStart, 6)
  // Madpakke klippes til man–tor i den viste uge
  const rangeEnd = entry.mealType === 1 ? addDays(weekStart, 3) : weekEnd
  if (!overlapsRange(entry, weekStart, rangeEnd)) return null

  const start = entry.date < weekStart ? weekStart : entry.date
  const end = entryEnd(entry) > rangeEnd ? rangeEnd : entryEnd(entry)
  if (start > end) return null

  const row = dayIndexInWeek(weekStart, start)
  const span = dayIndexInWeek(weekStart, end) - row + 1
  return { row: Math.max(0, row), span: Math.max(1, span) }
}

function formatDayLabel(iso: string, index: number) {
  const d = new Date(iso + 'T12:00:00')
  return {
    weekday: DAY_NAMES[index],
    date: d.toLocaleDateString('da-DK', { day: 'numeric', month: 'short' }),
    isToday: iso === new Date().toISOString().slice(0, 10),
  }
}

function rangeLabel(entry: MealPlanEntry) {
  const days = Math.max(1, entry.days ?? 1)
  if (days === 1) return formatShort(entry.date)
  return `${formatShort(entry.date)} → ${formatShort(entryEnd(entry))}`
}

function formatShort(iso: string) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('da-DK', {
    weekday: 'short',
    day: 'numeric',
    month: 'numeric',
  })
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
    const byId = new Map<string, MealPlanEntry>()
    for (const e of [...prevEntries, ...(plan?.entries ?? [])]) byId.set(e.id, e)
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
    let daysToSave = days
    if (adding.mealType === 1) {
      const max = maxMadpakkeDaysFrom(weekStart, adding.date)
      if (max < 1) {
        setError('Madpakke er kun man–tor.')
        return
      }
      daysToSave = Math.min(daysToSave, max)
    }
    try {
      await api.addMealEntry(plan.id, {
        date: adding.date,
        mealType: adding.mealType,
        recipeId,
        servings,
        days: daysToSave,
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
    if (!plan.entries.some((e) => e.id === entryId)) {
      setError('Retten er sat i forrige uge — skift uge for at fjerne den.')
      return
    }
    await api.removeMealEntry(plan.id, entryId)
    await load()
  }

  function openAdd(date: string, mealType: MealType) {
    const idx = dayIndexInWeek(weekStart, date)
    if (mealType === 1 && !allowsMadpakke(idx)) return
    setAdding({ date, mealType })
    setDays(1)
    const recipe = recipes.find((r) => r.id === recipeId)
    if (recipe) setServings(recipe.servings)
  }

  const madpakkeDayMax = adding?.mealType === 1 ? maxMadpakkeDaysFrom(weekStart, adding.date) : 14

  return (
    <section className="stack">
      <div className="panel row" style={{ justifyContent: 'space-between' }}>
        <button className="btn secondary" type="button" onClick={() => setWeekStart(addDays(weekStart, -7))}>
          ← Forrige
        </button>
        <div style={{ textAlign: 'center' }}>
          <h2>Tidslinje</h2>
          <p className="muted" style={{ margin: 0 }}>
            {loading ? 'Henter…' : `${weekDays[0]} → ${weekDays[6]}`}
          </p>
        </div>
        <button className="btn secondary" type="button" onClick={() => setWeekStart(addDays(weekStart, 7))}>
          Næste →
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {adding && (
        <div className="panel stack">
          <h3>
            Tilføj · {MEAL_LABELS[adding.mealType]} · {formatShort(adding.date)}
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
              <div className="field" style={{ maxWidth: 110 }}>
                <label>Portioner</label>
                <input
                  type="number"
                  min={0.5}
                  step={0.5}
                  value={servings}
                  onChange={(e) => setServings(Number(e.target.value))}
                />
              </div>
              <div className="field" style={{ maxWidth: 110 }}>
                <label>Dage</label>
                <input
                  type="number"
                  min={1}
                  max={madpakkeDayMax}
                  value={Math.min(days, madpakkeDayMax)}
                  onChange={(e) =>
                    setDays(Math.min(madpakkeDayMax, Math.max(1, Number(e.target.value) || 1)))
                  }
                />
              </div>
            </div>
          )}
          {adding.mealType === 1 && (
            <p className="muted" style={{ margin: 0 }}>
              Madpakke kun man–tor (max {madpakkeDayMax} dage herfra).
            </p>
          )}
          {days > 1 && adding.mealType === 2 && (
            <p className="muted" style={{ margin: 0 }}>
              Dækker {formatShort(adding.date)} → {formatShort(addDays(adding.date, days - 1))}
            </p>
          )}
          {days > 1 && adding.mealType === 1 && (
            <p className="muted" style={{ margin: 0 }}>
              Dækker {formatShort(adding.date)} →{' '}
              {formatShort(addDays(adding.date, Math.min(days, madpakkeDayMax) - 1))}
            </p>
          )}
          <div className="row">
            <button className="btn" type="button" disabled={!recipeId} onClick={() => void addEntry()}>
              Gem på tidslinjen
            </button>
            <button className="btn ghost" type="button" onClick={() => setAdding(null)}>
              Annuller
            </button>
          </div>
        </div>
      )}

      <div className="timeline panel">
        <div className="timeline-head">
          <div className="timeline-corner" />
          {MEAL_TYPES.map((type) => (
            <div key={type} className="timeline-track-title">
              {MEAL_LABELS[type]}
            </div>
          ))}
        </div>

        <div className="timeline-grid">
          <div className="timeline-days">
            {weekDays.map((date, index) => {
              const label = formatDayLabel(date, index)
              return (
                <div key={date} className={`timeline-day ${label.isToday ? 'is-today' : ''}`}>
                  <strong>{label.weekday}</strong>
                  <span>{label.date}</span>
                </div>
              )
            })}
          </div>

          {MEAL_TYPES.map((mealType) => {
            const trackEntries = allEntries
              .map((entry) => {
                if (entry.mealType !== mealType) return null
                const pos = clampSpanInWeek(entry, weekStart)
                if (!pos) return null
                return { entry, ...pos }
              })
              .filter(Boolean) as { entry: MealPlanEntry; row: number; span: number }[]

            return (
              <div key={mealType} className="timeline-track">
                {weekDays.map((date, index) => {
                  const blocked = mealType === 1 && !allowsMadpakke(index)
                  return blocked ? (
                    <div key={date} className="timeline-slot is-blocked" aria-hidden="true">
                      <span>Ingen</span>
                    </div>
                  ) : (
                    <button
                      key={date}
                      type="button"
                      className="timeline-slot"
                      aria-label={`Tilføj ${MEAL_LABELS[mealType]} ${date}`}
                      onClick={() => openAdd(date, mealType)}
                    />
                  )
                })}
                {trackEntries.map(({ entry, row, span }) => {
                  const owned = plan?.entries.some((e) => e.id === entry.id)
                  const totalDays = Math.max(1, entry.days ?? 1)
                  return (
                    <article
                      key={entry.id}
                      className={`timeline-bar meal-${mealType}`}
                      style={{ gridRow: `${row + 1} / span ${span}` }}
                    >
                      <div className="timeline-bar-body">
                        <strong>{entry.recipeTitle}</strong>
                        <span className="muted">{rangeLabel(entry)}</span>
                        <span className="macros">
                          {entry.servings} port.
                          {entry.macros ? ` · ${formatMacros(entry.macros)}` : ''}
                          {totalDays > 1 ? ` · ${totalDays} dage` : ''}
                        </span>
                      </div>
                      {owned && (
                        <button
                          className="btn ghost timeline-bar-remove"
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            void removeEntry(entry.id)
                          }}
                        >
                          Fjern
                        </button>
                      )}
                    </article>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
