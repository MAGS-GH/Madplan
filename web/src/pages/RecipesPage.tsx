import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import type { Recipe } from '../types'

export function RecipesPage() {
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void api
      .listRecipes()
      .then(setRecipes)
      .catch((e) => setError(e instanceof Error ? e.message : 'Fejl'))
  }, [])

  async function remove(id: string, title: string) {
    if (!confirm(`Slet “${title}”?`)) return
    try {
      await api.deleteRecipe(id)
      setRecipes((prev) => prev.filter((r) => r.id !== id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke slette')
    }
  }

  return (
    <section className="stack recipes-page">
      <div className="panel row recipes-page-head" style={{ justifyContent: 'space-between' }}>
        <div>
          <h2>Retter</h2>
          <p className="muted" style={{ margin: 0 }}>
            Jeres favoritter — med billeder, portioner og makroer.
          </p>
        </div>
        <Link className="btn accent" to="/retter/ny">
          Ny ret
        </Link>
      </div>

      {error && <div className="error">{error}</div>}

      {recipes.length === 0 ? (
        <div className="panel recipes-empty">
          <p style={{ margin: 0 }}>Ingen retter endnu.</p>
          <p className="muted" style={{ margin: 0 }}>
            Opret den første — eller hent en opskrift fra URL.
          </p>
          <Link className="btn accent" to="/retter/ny">
            Ny ret
          </Link>
        </div>
      ) : (
        <div className="recipe-gallery">
          {recipes.map((recipe) => {
            const ingredientThumbs = recipe.ingredients.filter((i) => i.imageUrl).slice(0, 5)
            return (
              <article key={recipe.id} className="recipe-card">
                <Link className="recipe-card-media" to={`/retter/${recipe.id}`}>
                  {recipe.imageUrl ? (
                    <img src={recipe.imageUrl} alt="" loading="lazy" />
                  ) : (
                    <div className="recipe-card-placeholder" aria-hidden="true">
                      <span>{recipe.title.slice(0, 1).toUpperCase()}</span>
                    </div>
                  )}
                </Link>
                <div className="recipe-card-body">
                  <div className="recipe-card-top">
                    <Link className="recipe-card-title" to={`/retter/${recipe.id}`}>
                      {recipe.title}
                    </Link>
                    <button
                      className="recipe-card-remove"
                      type="button"
                      title="Slet"
                      aria-label={`Slet ${recipe.title}`}
                      onClick={() => void remove(recipe.id, recipe.title)}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 6h18" />
                        <path d="M8 6V4h8v2" />
                        <path d="M19 6l-1 14H6L5 6" />
                        <path d="M10 11v6M14 11v6" />
                      </svg>
                    </button>
                  </div>
                  <div className="recipe-card-meta">
                    <span>{recipe.servings} portioner</span>
                    <span>{recipe.ingredients.length} ingredienser</span>
                  </div>
                  <div className="recipe-card-macros">
                    <span>{Math.round(recipe.perServingMacros.kcal)} kcal</span>
                    <span>Protein {Math.round(recipe.perServingMacros.protein)} g</span>
                    <span>Kulhydrat {Math.round(recipe.perServingMacros.carbs)} g</span>
                    <span>Fedt {Math.round(recipe.perServingMacros.fat)} g</span>
                  </div>
                  <p className="recipe-card-portion muted">Pr. portion</p>
                  {ingredientThumbs.length > 0 && (
                    <div className="recipe-card-ingredients" aria-hidden="true">
                      {ingredientThumbs.map((ing) => (
                        <img key={ing.id} src={ing.imageUrl!} alt="" loading="lazy" title={ing.name} />
                      ))}
                    </div>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
