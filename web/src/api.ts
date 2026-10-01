import type {
  MealPlan,
  Product,
  Recipe,
  ShoppingList,
  UpsertRecipeRequest,
} from './types'

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...init?.headers,
    },
  })

  if (!res.ok) {
    let message = res.statusText
    try {
      const data = await res.json()
      message = data.error ?? message
    } catch {
      /* ignore */
    }
    throw new Error(message || `Fejl ${res.status}`)
  }

  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const api = {
  health: () => request<{ status: string }>('/health'),

  listRecipes: () => request<Recipe[]>('/recipes'),
  getRecipe: (id: string) => request<Recipe>(`/recipes/${id}`),
  createRecipe: (body: UpsertRecipeRequest) =>
    request<Recipe>('/recipes', { method: 'POST', body: JSON.stringify(body) }),
  updateRecipe: (id: string, body: UpsertRecipeRequest) =>
    request<Recipe>(`/recipes/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteRecipe: (id: string) => request<void>(`/recipes/${id}`, { method: 'DELETE' }),

  getMealPlans: (weekStart?: string) =>
    request<MealPlan[]>(`/meal-plans${weekStart ? `?weekStart=${weekStart}` : ''}`),
  ensureMealPlan: (weekStart: string) =>
    request<MealPlan>('/meal-plans', {
      method: 'POST',
      body: JSON.stringify({ weekStart }),
    }),
  addMealEntry: (
    planId: string,
    body: { date: string; mealType: number; recipeId: string; servings: number; days: number },
  ) =>
    request(`/meal-plans/${planId}/entries`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  removeMealEntry: (planId: string, entryId: string) =>
    request<void>(`/meal-plans/${planId}/entries/${entryId}`, { method: 'DELETE' }),

  listShoppingLists: () => request<ShoppingList[]>('/shopping-lists'),
  getShoppingList: (id: string) => request<ShoppingList>(`/shopping-lists/${id}`),
  createShoppingFromPlan: (mealPlanId: string) =>
    request<ShoppingList>(`/shopping-lists/from-plan/${mealPlanId}`, { method: 'POST' }),
  addShoppingItem: (listId: string, body: { name: string; amount: number; unit: string }) =>
    request(`/shopping-lists/${listId}/items`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateShoppingItem: (
    listId: string,
    itemId: string,
    body: Partial<{ name: string; amount: number; unit: string; checked: boolean }>,
  ) =>
    request(`/shopping-lists/${listId}/items/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteShoppingItem: (listId: string, itemId: string) =>
    request<void>(`/shopping-lists/${listId}/items/${itemId}`, { method: 'DELETE' }),

  lookupBarcode: (code: string) => request<Product>(`/products/barcode/${encodeURIComponent(code)}`),
  scanLabel: async (file: File) => {
    const form = new FormData()
    form.append('image', file)
    return request<Product>('/products/label-scan', { method: 'POST', body: form })
  },
  listProducts: () => request<Product[]>('/products'),
}

export function macrosFromPer100g(
  amountG: number,
  p: Pick<Product, 'kcalPer100g' | 'proteinPer100g' | 'carbsPer100g' | 'fatPer100g'>,
) {
  const f = amountG / 100
  return {
    kcal: Math.round(p.kcalPer100g * f * 10) / 10,
    protein: Math.round(p.proteinPer100g * f * 10) / 10,
    carbs: Math.round(p.carbsPer100g * f * 10) / 10,
    fat: Math.round(p.fatPer100g * f * 10) / 10,
  }
}

export function toMonday(date: Date): string {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return d.toISOString().slice(0, 10)
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export function formatMacros(m: { kcal: number; protein: number; carbs: number; fat: number }) {
  return `${Math.round(m.kcal)} kcal · P ${m.protein} · K ${m.carbs} · F ${m.fat}`
}
