import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { addDays, api, formatMacros, toMonday } from '../api'
import type { MealPlan, MealPlanEntry, MealType, Recipe } from '../types'
import { MEAL_LABELS, MEAL_TYPES } from '../types'

const DAY_NAMES = ['Man', 'Tir', 'Ons', 'Tor', 'Fre', 'Lør', 'Søn']
const INITIAL_WEEKS_BACK = 1
const INITIAL_WEEKS_AHEAD = 3
const LOAD_WEEKS = 2

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

/** Man=0 … Søn=6 */
function weekdayIndex(date: string): number {
  return (new Date(date + 'T12:00:00').getDay() + 6) % 7
}

function allowsMadpakkeDate(date: string): boolean {
  return weekdayIndex(date) <= 3
}

function maxMadpakkeDaysFromDate(date: string): number {
  const idx = weekdayIndex(date)
  if (idx > 3) return 0
  return 4 - idx
}

function daysBetween(from: string, to: string): number {
  return Math.round(
    (new Date(to + 'T12:00:00').getTime() - new Date(from + 'T12:00:00').getTime()) / 86400000,
  )
}

function entryEnd(entry: MealPlanEntry): string {
  return addDays(entry.date, Math.max(1, entry.days ?? 1) - 1)
}

function overlapsRange(entry: MealPlanEntry, from: string, to: string): boolean {
  return entry.date <= to && entryEnd(entry) >= from
}

function mondaysInRange(rangeStart: string, rangeEnd: string): string[] {
  const first = toMonday(new Date(rangeStart + 'T12:00:00'))
  const mondays: string[] = []
  for (let d = first; d <= rangeEnd; d = addDays(d, 7)) mondays.push(d)
  return mondays
}

function formatDayLabel(iso: string) {
  const d = new Date(iso + 'T12:00:00')
  const idx = weekdayIndex(iso)
  return {
    weekday: DAY_NAMES[idx],
    date: d.toLocaleDateString('da-DK', { day: 'numeric', month: 'short' }),
    isToday: iso === todayIso(),
    isMonday: idx === 0,
  }
}

function isoWeekNumber(iso: string): number {
  const d = new Date(iso + 'T12:00:00')
  const dayNum = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - dayNum + 3)
  const firstThursday = new Date(d.getFullYear(), 0, 4)
  const weekOneDay = (firstThursday.getDay() + 6) % 7
  firstThursday.setDate(firstThursday.getDate() - weekOneDay + 3)
  return 1 + Math.round((d.getTime() - firstThursday.getTime()) / 604800000)
}

function weekDividerLabel(mondayIso: string) {
  const d = new Date(mondayIso + 'T12:00:00')
  const week = isoWeekNumber(mondayIso)
  const month = d.toLocaleDateString('da-DK', { month: 'long' })
  return `Uge ${week} · ${month}`
}

type TimelineRow =
  | { kind: 'day'; date: string }
  | { kind: 'divider'; key: string; label: string }

function buildTimelineRows(days: string[]): TimelineRow[] {
  const rows: TimelineRow[] = []
  for (const date of days) {
    if (weekdayIndex(date) === 0) {
      rows.push({ kind: 'divider', key: `w-${date}`, label: weekDividerLabel(date) })
    }
    rows.push({ kind: 'day', date })
  }
  return rows
}

function dayRowIndex(rows: TimelineRow[], date: string): number {
  return rows.findIndex((r) => r.kind === 'day' && r.date === date)
}

function clampSpanInRows(
  entry: MealPlanEntry,
  rangeStart: string,
  rangeEnd: string,
  rows: TimelineRow[],
): { row: number; span: number } | null {
  if (!overlapsRange(entry, rangeStart, rangeEnd)) return null

  const start = entry.date < rangeStart ? rangeStart : entry.date
  const end = entryEnd(entry) > rangeEnd ? rangeEnd : entryEnd(entry)
  if (start > end) return null

  const row = dayRowIndex(rows, start)
  const endRow = dayRowIndex(rows, end)
  if (row < 0 || endRow < 0) return null
  return { row, span: endRow - row + 1 }
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

function mergePlans(existing: MealPlan[], incoming: MealPlan[]): MealPlan[] {
  const byId = new Map(existing.map((p) => [p.id, p]))
  for (const p of incoming) byId.set(p.id, p)
  return [...byId.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart))
}

export function MealPlanPage() {
  const todayMonday = toMonday(new Date())
  const [rangeStart, setRangeStart] = useState(() => addDays(todayMonday, -7 * INITIAL_WEEKS_BACK))
  const [rangeEnd, setRangeEnd] = useState(() =>
    addDays(todayMonday, 7 * INITIAL_WEEKS_AHEAD - 1),
  )
  const [plans, setPlans] = useState<MealPlan[]>([])
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState<'past' | 'future' | null>(null)
  const [adding, setAdding] = useState<{ date: string; mealType: MealType } | null>(null)
  const [recipeId, setRecipeId] = useState('')
  const [servings, setServings] = useState(2)
  const [days, setDays] = useState(1)

  const scrollRef = useRef<HTMLDivElement>(null)
  const topSentinelRef = useRef<HTMLDivElement>(null)
  const bottomSentinelRef = useRef<HTMLDivElement>(null)
  const todayRowRef = useRef<HTMLDivElement>(null)
  const prependAdjustRef = useRef<number | null>(null)
  const loadingMoreRef = useRef<'past' | 'future' | null>(null)
  const rangeStartRef = useRef(rangeStart)
  const rangeEndRef = useRef(rangeEnd)
  rangeStartRef.current = rangeStart
  rangeEndRef.current = rangeEnd

  const dayCount = daysBetween(rangeStart, rangeEnd) + 1
  const visibleDays = useMemo(
    () => Array.from({ length: dayCount }, (_, i) => addDays(rangeStart, i)),
    [rangeStart, dayCount],
  )
  const timelineRows = useMemo(() => buildTimelineRows(visibleDays), [visibleDays])
  const rowCount = timelineRows.length
  const rowTemplate = useMemo(
    () =>
      timelineRows
        .map((r) => (r.kind === 'divider' ? '2rem' : 'minmax(4.6rem, auto)'))
        .join(' '),
    [timelineRows],
  )

  const allEntries = useMemo(() => {
    const byId = new Map<string, MealPlanEntry>()
    for (const plan of plans) for (const e of plan.entries) byId.set(e.id, e)
    return [...byId.values()]
  }, [plans])

  const entryOwner = useMemo(() => {
    const map = new Map<string, string>()
    for (const plan of plans) for (const e of plan.entries) map.set(e.id, plan.id)
    return map
  }, [plans])

  async function loadRange(from: string, to: string, mode: 'replace' | 'merge' = 'replace') {
    // Hent én uge før for retter der spænder ind i intervallet
    const fetchFrom = addDays(from, -7)
    const mondays = mondaysInRange(fetchFrom, to)
    const [fetched, recipeList] = await Promise.all([
      Promise.all(mondays.map((m) => api.getMealPlans(m))),
      mode === 'replace' ? api.listRecipes() : Promise.resolve(null),
    ])
    const loaded = fetched.flat()
    setPlans((prev) => (mode === 'replace' ? mergePlans([], loaded) : mergePlans(prev, loaded)))
    if (recipeList) {
      setRecipes(recipeList)
      if (recipeList[0]) setRecipeId((id) => id || recipeList[0].id)
    }
  }

  const didScrollToToday = useRef(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        await loadRange(rangeStart, rangeEnd, 'replace')
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Kunne ikke hente tidslinje')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (loading || didScrollToToday.current) return
    didScrollToToday.current = true
    requestAnimationFrame(() => {
      todayRowRef.current?.scrollIntoView({ block: 'center' })
    })
  }, [loading])

  useLayoutEffect(() => {
    const el = scrollRef.current
    const adjust = prependAdjustRef.current
    if (!el || adjust == null) return
    el.scrollTop += el.scrollHeight - adjust
    prependAdjustRef.current = null
  }, [rangeStart])

  useEffect(() => {
    if (loading) return
    const root = scrollRef.current
    if (!root) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || loadingMoreRef.current) continue
          if (entry.target === topSentinelRef.current) void expandPast()
          if (entry.target === bottomSentinelRef.current) void expandFuture()
        }
      },
      { root, rootMargin: '320px 0px', threshold: 0 },
    )

    const top = topSentinelRef.current
    const bottom = bottomSentinelRef.current
    if (top) observer.observe(top)
    if (bottom) observer.observe(bottom)
    return () => observer.disconnect()
  }, [loading])

  async function expandPast() {
    if (loadingMoreRef.current) return
    loadingMoreRef.current = 'past'
    setLoadingMore('past')
    const el = scrollRef.current
    if (el) prependAdjustRef.current = el.scrollHeight

    const currentStart = rangeStartRef.current
    const nextStart = addDays(currentStart, -7 * LOAD_WEEKS)
    const nextEnd = addDays(currentStart, -1)
    try {
      await loadRange(nextStart, nextEnd, 'merge')
      setRangeStart(nextStart)
    } catch (e) {
      prependAdjustRef.current = null
      setError(e instanceof Error ? e.message : 'Kunne ikke hente tidligere uger')
    } finally {
      loadingMoreRef.current = null
      setLoadingMore(null)
    }
  }

  async function expandFuture() {
    if (loadingMoreRef.current) return
    loadingMoreRef.current = 'future'
    setLoadingMore('future')
    const currentEnd = rangeEndRef.current
    const nextStart = addDays(currentEnd, 1)
    const nextEnd = addDays(currentEnd, 7 * LOAD_WEEKS)
    try {
      await loadRange(nextStart, nextEnd, 'merge')
      setRangeEnd(nextEnd)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke hente flere uger')
    } finally {
      loadingMoreRef.current = null
      setLoadingMore(null)
    }
  }

  function scrollToToday() {
    todayRowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  async function refreshVisible() {
    try {
      await loadRange(rangeStart, rangeEnd, 'merge')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke opdatere')
    }
  }

  async function addEntry() {
    if (!recipeId || !adding) return
    let daysToSave = days
    if (adding.mealType === 1) {
      const max = maxMadpakkeDaysFromDate(adding.date)
      if (max < 1) {
        setError('Madpakke er kun man–tor.')
        return
      }
      daysToSave = Math.min(daysToSave, max)
    }
    try {
      const plan = await api.ensureMealPlan(toMonday(new Date(adding.date + 'T12:00:00')))
      await api.addMealEntry(plan.id, {
        date: adding.date,
        mealType: adding.mealType,
        recipeId,
        servings,
        days: daysToSave,
      })
      setAdding(null)
      setDays(1)
      await refreshVisible()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke tilføje måltid')
    }
  }

  async function removeEntry(entryId: string) {
    const planId = entryOwner.get(entryId)
    if (!planId) {
      setError('Kunne ikke finde måltidet.')
      return
    }
    await api.removeMealEntry(planId, entryId)
    await refreshVisible()
  }

  function openAdd(date: string, mealType: MealType) {
    if (mealType === 1 && !allowsMadpakkeDate(date)) return
    setAdding({ date, mealType })
    setDays(1)
    const recipe = recipes.find((r) => r.id === recipeId)
    if (recipe) setServings(recipe.servings)
  }

  const madpakkeDayMax = adding?.mealType === 1 ? maxMadpakkeDaysFromDate(adding.date) : 14

  return (
    <section className="stack">
      <div className="panel row timeline-toolbar">
        <div>
          <h2 style={{ margin: 0 }}>Tidslinje</h2>
          <p className="muted" style={{ margin: 0 }}>
            {loading ? 'Henter…' : 'Scroll for at se flere dage'}
          </p>
        </div>
        <button className="btn secondary" type="button" onClick={scrollToToday}>
          I dag
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
          {days > 1 && (
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

        <div className="timeline-scroll" ref={scrollRef}>
          <div ref={topSentinelRef} className="timeline-sentinel">
            {loadingMore === 'past' ? 'Henter…' : ''}
          </div>

          <div
            className="timeline-grid"
            style={{
              gridTemplateRows: rowTemplate,
              ['--day-count' as string]: rowCount,
            }}
          >
            <div className="timeline-days">
              {timelineRows.map((row) => {
                if (row.kind === 'divider') {
                  return (
                    <div key={row.key} className="timeline-week-divider" aria-hidden="true">
                      <span>{row.label}</span>
                    </div>
                  )
                }
                const label = formatDayLabel(row.date)
                return (
                  <div
                    key={row.date}
                    ref={label.isToday ? todayRowRef : undefined}
                    className={`timeline-day ${label.isToday ? 'is-today' : ''}`}
                  >
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
                  const pos = clampSpanInRows(entry, rangeStart, rangeEnd, timelineRows)
                  if (!pos) return null
                  return { entry, ...pos }
                })
                .filter(Boolean) as { entry: MealPlanEntry; row: number; span: number }[]

              return (
                <div key={mealType} className="timeline-track">
                  {timelineRows.map((row) => {
                    if (row.kind === 'divider') {
                      return <div key={row.key} className="timeline-week-divider-gap" aria-hidden="true" />
                    }
                    const blocked = mealType === 1 && !allowsMadpakkeDate(row.date)
                    return blocked ? (
                      <div key={row.date} className="timeline-slot is-blocked" aria-hidden="true">
                        <span>Ingen</span>
                      </div>
                    ) : (
                      <button
                        key={row.date}
                        type="button"
                        className="timeline-slot"
                        aria-label={`Tilføj ${MEAL_LABELS[mealType]} ${row.date}`}
                        onClick={() => openAdd(row.date, mealType)}
                      />
                    )
                  })}
                  {trackEntries.map(({ entry, row, span }) => {
                    const owned = entryOwner.has(entry.id)
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

          <div ref={bottomSentinelRef} className="timeline-sentinel">
            {loadingMore === 'future' ? 'Henter…' : ''}
          </div>
        </div>
      </div>
    </section>
  )
}
