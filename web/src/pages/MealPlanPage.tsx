import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { addDays, api, formatMacros, toMonday } from '../api'
import type { Macros, MealPlan, MealPlanEntry, MealType, Recipe } from '../types'
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

/** Klipp bars ved ugeskift, så de aldrig spænder over divider-rækker. */
function entrySegments(
  entry: MealPlanEntry,
  rangeStart: string,
  rangeEnd: string,
  rows: TimelineRow[],
): { row: number; span: number; primary: boolean }[] {
  if (!overlapsRange(entry, rangeStart, rangeEnd)) return []

  const start = entry.date < rangeStart ? rangeStart : entry.date
  const end = entryEnd(entry) > rangeEnd ? rangeEnd : entryEnd(entry)
  if (start > end) return []

  const dates: string[] = []
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (dayRowIndex(rows, d) >= 0) dates.push(d)
  }
  if (dates.length === 0) return []

  const groups: string[][] = [[dates[0]]]
  for (let i = 1; i < dates.length; i++) {
    const prev = dates[i - 1]
    const curr = dates[i]
    const prevRow = dayRowIndex(rows, prev)
    const currRow = dayRowIndex(rows, curr)
    if (currRow > prevRow + 1) groups.push([curr])
    else groups[groups.length - 1].push(curr)
  }

  return groups.map((group, index) => {
    const row = dayRowIndex(rows, group[0])
    const endRow = dayRowIndex(rows, group[group.length - 1])
    return { row, span: endRow - row + 1, primary: index === 0 }
  })
}

function mealColumn(mealType: MealType): number {
  return mealType === 1 ? 2 : 3
}

function rangeLabel(entry: MealPlanEntry) {
  const days = Math.max(1, entry.days ?? 1)
  if (days === 1) return formatShort(entry.date)
  return `${formatShort(entry.date)} → ${formatShort(entryEnd(entry))}`
}

function formatMacroValue(value: number) {
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

function MacroDetails({ macros }: { macros: Macros }) {
  return (
    <dl className="timeline-macro-details">
      <div>
        <dt>Kalorier</dt>
        <dd>{Math.round(macros.kcal)} kcal</dd>
      </div>
      <div>
        <dt>Protein</dt>
        <dd>{formatMacroValue(macros.protein)} g</dd>
      </div>
      <div>
        <dt>Kulhydrat</dt>
        <dd>{formatMacroValue(macros.carbs)} g</dd>
      </div>
      <div>
        <dt>Fedt</dt>
        <dd>{formatMacroValue(macros.fat)} g</dd>
      </div>
    </dl>
  )
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
  const rowTemplate = useMemo(
    () =>
      timelineRows
        .map((r) => (r.kind === 'divider' ? '2rem' : 'minmax(6.2rem, auto)'))
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

  const madpakkeDayMax = adding?.mealType === 1 ? maxMadpakkeDaysFromDate(adding.date) : 14
  const draftDays = Math.min(Math.max(1, days), madpakkeDayMax || 1)
  const selectedRecipe = recipes.find((r) => r.id === recipeId)

  const draftEntry = useMemo((): MealPlanEntry | null => {
    if (!adding) return null
    return {
      id: '__draft__',
      date: adding.date,
      mealType: adding.mealType,
      recipeId: recipeId || '__draft__',
      recipeTitle: selectedRecipe?.title ?? 'Ny ret',
      servings,
      days: draftDays,
      recipeImageUrl: selectedRecipe?.imageUrl ?? null,
    }
  }, [adding, recipeId, servings, draftDays, selectedRecipe])

  const draftSegments = useMemo(
    () =>
      draftEntry ? entrySegments(draftEntry, rangeStart, rangeEnd, timelineRows) : [],
    [draftEntry, rangeStart, rangeEnd, timelineRows],
  )

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
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 959px)').matches) {
      requestAnimationFrame(() => {
        document.querySelector('.plan-side')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      })
    }
  }

  return (
    <section className="plan-layout">
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

          <div className="timeline-grid" style={{ gridTemplateRows: rowTemplate }}>
            {timelineRows.map((row, rowIndex) => {
              if (row.kind === 'divider') {
                return (
                  <div
                    key={row.key}
                    className="timeline-week-divider"
                    style={{ gridColumn: '1 / -1', gridRow: rowIndex + 1 }}
                  >
                    <span>{row.label}</span>
                  </div>
                )
              }

              const label = formatDayLabel(row.date)
              return (
                <Fragment key={row.date}>
                  <div
                    ref={label.isToday ? todayRowRef : undefined}
                    className={`timeline-day ${label.isToday ? 'is-today' : ''}`}
                    style={{ gridColumn: 1, gridRow: rowIndex + 1 }}
                  >
                    <strong>{label.weekday}</strong>
                    <span>{label.date}</span>
                  </div>
                  {MEAL_TYPES.map((mealType) => {
                    const blocked = mealType === 1 && !allowsMadpakkeDate(row.date)
                    const col = mealColumn(mealType)
                    return blocked ? (
                      <div
                        key={`${row.date}-${mealType}`}
                        className="timeline-slot is-blocked"
                        style={{ gridColumn: col, gridRow: rowIndex + 1 }}
                        aria-hidden="true"
                      >
                        <span>Ingen</span>
                      </div>
                    ) : (
                      <button
                        key={`${row.date}-${mealType}`}
                        type="button"
                        className="timeline-slot"
                        style={{ gridColumn: col, gridRow: rowIndex + 1 }}
                        aria-label={`Tilføj ${MEAL_LABELS[mealType]} ${row.date}`}
                        onClick={() => openAdd(row.date, mealType)}
                      />
                    )
                  })}
                </Fragment>
              )
            })}

            {draftEntry &&
              draftSegments.map((seg) => (
                <article
                  key={`draft-${seg.row}`}
                  className={`timeline-bar is-draft meal-${draftEntry.mealType}${seg.span > 1 ? ' is-tall is-detailed' : ''}${seg.primary ? '' : ' is-continuation'}`}
                  style={{
                    gridColumn: mealColumn(draftEntry.mealType),
                    gridRow: `${seg.row + 1} / span ${seg.span}`,
                  }}
                  aria-hidden="true"
                >
                  <div className="timeline-bar-main">
                    {draftEntry.recipeImageUrl ? (
                      <img
                        className="timeline-bar-thumb"
                        src={draftEntry.recipeImageUrl}
                        alt=""
                        loading="lazy"
                      />
                    ) : null}
                    <div className="timeline-bar-body">
                      <strong className="timeline-bar-title">{draftEntry.recipeTitle}</strong>
                      {seg.primary ? (
                        <>
                          <span className="muted">{rangeLabel(draftEntry)}</span>
                          <span className="macros">
                            {draftEntry.servings} port.
                            {draftDays > 1 ? ` · ${draftDays} dage` : ''}
                          </span>
                          {seg.span > 1 && selectedRecipe?.perServingMacros ? (
                            <MacroDetails
                              macros={{
                                kcal: selectedRecipe.perServingMacros.kcal * draftEntry.servings,
                                protein: selectedRecipe.perServingMacros.protein * draftEntry.servings,
                                carbs: selectedRecipe.perServingMacros.carbs * draftEntry.servings,
                                fat: selectedRecipe.perServingMacros.fat * draftEntry.servings,
                              }}
                            />
                          ) : null}
                        </>
                      ) : (
                        <span className="muted">fortsætter</span>
                      )}
                    </div>
                  </div>
                </article>
              ))}

            {allEntries.flatMap((entry) => {
              const segments = entrySegments(entry, rangeStart, rangeEnd, timelineRows)
              const owned = entryOwner.has(entry.id)
              const totalDays = Math.max(1, entry.days ?? 1)
              return segments.map((seg) => (
                <article
                  key={`${entry.id}-${seg.row}`}
                  className={`timeline-bar meal-${entry.mealType}${seg.span > 1 ? ' is-tall is-detailed' : ''}${seg.primary ? '' : ' is-continuation'}`}
                  style={{
                    gridColumn: mealColumn(entry.mealType),
                    gridRow: `${seg.row + 1} / span ${seg.span}`,
                  }}
                >
                  {owned && seg.primary && (
                    <button
                      className="timeline-bar-remove"
                      type="button"
                      title="Fjern"
                      aria-label={`Fjern ${entry.recipeTitle}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        void removeEntry(entry.id)
                      }}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 6h18" />
                        <path d="M8 6V4h8v2" />
                        <path d="M19 6l-1 14H6L5 6" />
                        <path d="M10 11v6M14 11v6" />
                      </svg>
                    </button>
                  )}
                  <div className="timeline-bar-main">
                    {entry.recipeImageUrl ? (
                      <img
                        className="timeline-bar-thumb"
                        src={entry.recipeImageUrl}
                        alt=""
                        loading="lazy"
                      />
                    ) : null}
                    <div className="timeline-bar-body">
                      <Link
                        className="timeline-bar-title"
                        to={`/retter/${entry.recipeId}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {entry.recipeTitle}
                      </Link>
                      {seg.primary ? (
                        <>
                          <span className="muted">{rangeLabel(entry)}</span>
                          <span className="macros">
                            {entry.servings} port.
                            {totalDays > 1 ? ` · ${totalDays} dage` : ''}
                            {seg.span === 1 && entry.macros ? ` · ${formatMacros(entry.macros)}` : ''}
                          </span>
                          {seg.span > 1 && entry.macros ? <MacroDetails macros={entry.macros} /> : null}
                        </>
                      ) : (
                        <span className="muted">fortsætter</span>
                      )}
                    </div>
                  </div>
                </article>
              ))
            })}
          </div>

          <div ref={bottomSentinelRef} className="timeline-sentinel">
            {loadingMore === 'future' ? 'Henter…' : ''}
          </div>
        </div>
      </div>

      <aside className="plan-side panel stack">
        <div className="plan-side-head">
          <div>
            <h2 style={{ margin: 0 }}>Ugeplan</h2>
            <p className="muted" style={{ margin: 0 }}>
              {loading ? 'Henter…' : 'Scroll i kalenderen'}
            </p>
          </div>
          <button className="btn secondary" type="button" onClick={scrollToToday}>
            I dag
          </button>
        </div>

        {error && (
          <div className="error" style={{ marginBottom: 0 }}>
            {error}
          </div>
        )}

        {adding ? (
          <div className="plan-side-form stack">
            <div>
              <p className="plan-side-kicker">{MEAL_LABELS[adding.mealType]}</p>
              <h3 style={{ margin: 0 }}>{formatShort(adding.date)}</h3>
            </div>
            {recipes.length === 0 ? (
              <p style={{ margin: 0 }}>
                Ingen retter endnu. <Link to="/retter/ny">Opret en ret</Link> først.
              </p>
            ) : (
              <>
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
                <div className="row">
                  <div className="field">
                    <label>Portioner</label>
                    <input
                      type="number"
                      min={0.5}
                      step={0.5}
                      value={servings}
                      onChange={(e) => setServings(Number(e.target.value))}
                    />
                  </div>
                  <div className="field">
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
              </>
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
            <div className="plan-side-actions">
              <button
                className="btn"
                type="button"
                disabled={!recipeId || recipes.length === 0}
                onClick={() => void addEntry()}
              >
                Gem
              </button>
              <button className="btn ghost" type="button" onClick={() => setAdding(null)}>
                Annuller
              </button>
            </div>
          </div>
        ) : (
          <div className="plan-side-empty">
            <p style={{ margin: 0 }}>
              Tryk på en tom plads i kalenderen for at tilføje madpakke eller aftensmad.
            </p>
            <p className="muted" style={{ margin: 0 }}>
              Retter der spænder flere dage vises som sammenhængende blokke.
            </p>
            <Link className="btn secondary" to="/retter/ny">
              Ny ret
            </Link>
          </div>
        )}
      </aside>
    </section>
  )
}
