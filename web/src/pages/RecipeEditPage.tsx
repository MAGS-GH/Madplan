import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, formatMacros, macrosFromPer100g } from '../api'
import type { Product, RecipeIngredientInput } from '../types'

type DraftIngredient = RecipeIngredientInput & { key: string }

function emptyIngredient(): DraftIngredient {
  return {
    key: crypto.randomUUID(),
    name: '',
    amount: 100,
    unit: 'g',
    kcal: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    productId: null,
  }
}

export function RecipeEditPage() {
  const { id } = useParams()
  const isNew = !id || id === 'ny'
  const navigate = useNavigate()

  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [servings, setServings] = useState(2)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [ingredients, setIngredients] = useState<DraftIngredient[]>([emptyIngredient()])
  const [products, setProducts] = useState<Product[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [importUrl, setImportUrl] = useState('')
  const [importing, setImporting] = useState(false)
  const [importInfo, setImportInfo] = useState<string | null>(null)

  useEffect(() => {
    void api.listProducts().then(setProducts).catch(() => undefined)
    if (!isNew && id) {
      void api
        .getRecipe(id)
        .then((recipe) => {
          setTitle(recipe.title)
          setNotes(recipe.notes ?? '')
          setServings(recipe.servings)
          setImageUrl(recipe.imageUrl ?? null)
          setIngredients(
            recipe.ingredients.map((i) => ({
              key: i.id,
              productId: i.productId,
              name: i.name,
              amount: i.amount,
              unit: i.unit,
              kcal: i.kcal,
              protein: i.protein,
              carbs: i.carbs,
              fat: i.fat,
            })),
          )
        })
        .catch((e) => setError(e instanceof Error ? e.message : 'Kunne ikke hente ret'))
    }
  }, [id, isNew])

  const totals = useMemo(() => {
    return ingredients.reduce(
      (acc, i) => ({
        kcal: acc.kcal + Number(i.kcal || 0),
        protein: acc.protein + Number(i.protein || 0),
        carbs: acc.carbs + Number(i.carbs || 0),
        fat: acc.fat + Number(i.fat || 0),
      }),
      { kcal: 0, protein: 0, carbs: 0, fat: 0 },
    )
  }, [ingredients])

  const perServing = useMemo(() => {
    const s = Math.max(1, servings)
    return {
      kcal: Math.round((totals.kcal / s) * 10) / 10,
      protein: Math.round((totals.protein / s) * 10) / 10,
      carbs: Math.round((totals.carbs / s) * 10) / 10,
      fat: Math.round((totals.fat / s) * 10) / 10,
    }
  }, [totals, servings])

  function updateIngredient(key: string, patch: Partial<DraftIngredient>) {
    setIngredients((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)))
  }

  function applyProduct(key: string, productId: string) {
    const product = products.find((p) => p.id === productId)
    if (!product) return
    const amount = 100
    const macros = macrosFromPer100g(amount, product)
    updateIngredient(key, {
      productId,
      name: product.brand ? `${product.name} (${product.brand})` : product.name,
      amount,
      unit: 'g',
      ...macros,
    })
  }

  function recalcFromAmount(key: string, amount: number) {
    const ing = ingredients.find((i) => i.key === key)
    if (!ing?.productId) {
      updateIngredient(key, { amount })
      return
    }
    const product = products.find((p) => p.id === ing.productId)
    if (!product) {
      updateIngredient(key, { amount })
      return
    }
    updateIngredient(key, { amount, ...macrosFromPer100g(amount, product) })
  }

  async function importFromUrl() {
    const url = importUrl.trim()
    if (!url) return
    setImporting(true)
    setError(null)
    setImportInfo(null)
    try {
      const imported = await api.importRecipeFromUrl(url)
      setTitle(imported.title)
      setNotes(imported.notes ?? '')
      setServings(Math.max(1, imported.servings || 2))
      setImageUrl(imported.imageUrl ?? null)
      setIngredients(
        imported.ingredients.length > 0
          ? imported.ingredients.map((i) => ({
              key: crypto.randomUUID(),
              productId: i.productId ?? null,
              name: i.name,
              amount: i.amount,
              unit: i.unit,
              kcal: i.kcal,
              protein: i.protein,
              carbs: i.carbs,
              fat: i.fat,
            }))
          : [emptyIngredient()],
      )
      setImportInfo(`Hentet ${imported.ingredients.length} ingredienser — tjek og gem.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke importere opskrift')
    } finally {
      setImporting(false)
    }
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const body = {
        title: title.trim(),
        notes: notes.trim() || null,
        servings,
        imageUrl: imageUrl?.trim() || null,
        ingredients: ingredients
          .filter((i) => i.name.trim())
          .map(({ productId, name, amount, unit, kcal, protein, carbs, fat }) => ({
            productId,
            name,
            amount,
            unit,
            kcal,
            protein,
            carbs,
            fat,
          })),
      }
      if (isNew) {
        const created = await api.createRecipe(body)
        navigate(`/retter/${created.id}`)
      } else if (id) {
        await api.updateRecipe(id, body)
        navigate('/retter')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke gemme')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="stack">
      <div className="panel row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h2>{isNew ? 'Ny ret' : 'Rediger ret'}</h2>
          <p className="muted" style={{ margin: 0 }}>
            Makroer summeres automatisk fra ingredienserne.
          </p>
        </div>
        <Link className="btn secondary" to="/retter">
          Tilbage
        </Link>
      </div>

      {error && <div className="error">{error}</div>}
      {importInfo && <div className="success">{importInfo}</div>}

      {isNew && (
        <div className="panel stack">
          <h3 style={{ margin: 0 }}>Import fra URL</h3>
          <p className="muted" style={{ margin: 0 }}>
            Indsæt et link til en opskrift — AI henter titel, ingredienser, makroer og fremgangsmåde.
          </p>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <div className="field" style={{ flex: 1 }}>
              <label>Opskrifts-URL</label>
              <input
                value={importUrl}
                onChange={(e) => setImportUrl(e.target.value)}
                placeholder="https://…"
                inputMode="url"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void importFromUrl()
                  }
                }}
              />
            </div>
            <button
              className="btn accent"
              type="button"
              disabled={importing || !importUrl.trim()}
              onClick={() => void importFromUrl()}
            >
              {importing ? 'Henter…' : 'Hent med AI'}
            </button>
          </div>
        </div>
      )}

      <div className="panel stack">
        <div className="row">
          <div className="field">
            <label>Titel</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Fx Pasta bolognese" />
          </div>
          <div className="field" style={{ maxWidth: 140 }}>
            <label>Portioner</label>
            <input
              type="number"
              min={1}
              value={servings}
              onChange={(e) => setServings(Number(e.target.value))}
            />
          </div>
        </div>
        {imageUrl && (
          <div className="field">
            <label>Billede</label>
            <img className="preview-img" src={imageUrl} alt="" />
            <input value={imageUrl} onChange={(e) => setImageUrl(e.target.value || null)} />
          </div>
        )}
        <div className="field">
          <label>Noter</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Fremgangsmåde, tips…" />
        </div>
      </div>

      <div className="panel stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3>Ingredienser</h3>
          <button className="btn secondary" type="button" onClick={() => setIngredients((p) => [...p, emptyIngredient()])}>
            + Ingrediens
          </button>
        </div>

        {ingredients.map((ing) => (
          <div key={ing.key} className="stack" style={{ borderTop: '1px solid var(--line)', paddingTop: '0.75rem' }}>
            <div className="row">
              <div className="field">
                <label>Fra produkt (valgfrit)</label>
                <select
                  value={ing.productId ?? ''}
                  onChange={(e) => {
                    if (e.target.value) applyProduct(ing.key, e.target.value)
                    else updateIngredient(ing.key, { productId: null })
                  }}
                >
                  <option value="">Manuel</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.brand ? ` · ${p.brand}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Navn</label>
                <input
                  value={ing.name}
                  onChange={(e) => updateIngredient(ing.key, { name: e.target.value })}
                  placeholder="Hakket oksekød"
                />
              </div>
            </div>
            <div className="row">
              <div className="field" style={{ maxWidth: 110 }}>
                <label>Mængde</label>
                <input
                  type="number"
                  value={ing.amount}
                  onChange={(e) => recalcFromAmount(ing.key, Number(e.target.value))}
                />
              </div>
              <div className="field" style={{ maxWidth: 90 }}>
                <label>Enhed</label>
                <input value={ing.unit} onChange={(e) => updateIngredient(ing.key, { unit: e.target.value })} />
              </div>
              <div className="field" style={{ maxWidth: 90 }}>
                <label>Kcal</label>
                <input
                  type="number"
                  value={ing.kcal}
                  onChange={(e) => updateIngredient(ing.key, { kcal: Number(e.target.value) })}
                />
              </div>
              <div className="field" style={{ maxWidth: 80 }}>
                <label>P</label>
                <input
                  type="number"
                  value={ing.protein}
                  onChange={(e) => updateIngredient(ing.key, { protein: Number(e.target.value) })}
                />
              </div>
              <div className="field" style={{ maxWidth: 80 }}>
                <label>K</label>
                <input
                  type="number"
                  value={ing.carbs}
                  onChange={(e) => updateIngredient(ing.key, { carbs: Number(e.target.value) })}
                />
              </div>
              <div className="field" style={{ maxWidth: 80 }}>
                <label>F</label>
                <input
                  type="number"
                  value={ing.fat}
                  onChange={(e) => updateIngredient(ing.key, { fat: Number(e.target.value) })}
                />
              </div>
              <button
                className="btn ghost"
                type="button"
                onClick={() => setIngredients((prev) => prev.filter((i) => i.key !== ing.key))}
              >
                Fjern
              </button>
            </div>
          </div>
        ))}

        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <div className="chip">Total: {formatMacros(totals)}</div>
            <div className="chip" style={{ marginLeft: '0.35rem' }}>
              Pr. portion: {formatMacros(perServing)}
            </div>
          </div>
          <button className="btn" type="button" disabled={saving || !title.trim()} onClick={() => void save()}>
            {saving ? 'Gemmer…' : 'Gem ret'}
          </button>
        </div>
      </div>
    </section>
  )
}
