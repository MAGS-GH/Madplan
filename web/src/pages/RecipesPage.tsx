import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, formatMacros } from '../api'
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

  async function remove(id: string) {
    if (!confirm('Slet denne ret?')) return
    try {
      await api.deleteRecipe(id)
      setRecipes((prev) => prev.filter((r) => r.id !== id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke slette')
    }
  }

  return (
    <section>
      <div className="panel row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h2>Retter</h2>
          <p className="muted" style={{ margin: 0 }}>
            Gem mad I har lavet — med makroer pr. ret og pr. portion.
          </p>
        </div>
        <Link className="btn accent" to="/retter/ny">
          Ny ret
        </Link>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="panel">
        {recipes.length === 0 ? (
          <p>Ingen retter endnu. Opret den første!</p>
        ) : (
          <ul className="list">
            {recipes.map((recipe) => (
              <li key={recipe.id}>
                <div className="row" style={{ alignItems: 'center', gap: '0.85rem', flex: 1 }}>
                  {recipe.imageUrl ? (
                    <img className="recipe-list-thumb" src={recipe.imageUrl} alt="" />
                  ) : (
                    <div className="recipe-list-thumb is-empty" />
                  )}
                  <div>
                    <Link to={`/retter/${recipe.id}`}>
                      <strong>{recipe.title}</strong>
                    </Link>
                    <div className="macros">{formatMacros(recipe.perServingMacros)} / portion</div>
                    <div className="muted">
                      {recipe.servings} portioner · {recipe.ingredients.length} ingredienser
                    </div>
                  </div>
                </div>
                <button className="btn ghost" type="button" onClick={() => void remove(recipe.id)}>
                  Slet
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
