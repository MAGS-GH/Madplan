export type Macros = {
  kcal: number
  protein: number
  carbs: number
  fat: number
}

export type RecipeIngredient = {
  id: string
  productId?: string | null
  name: string
  amount: number
  unit: string
  kcal: number
  protein: number
  carbs: number
  fat: number
  imageUrl?: string | null
}

export type Recipe = {
  id: string
  title: string
  notes?: string | null
  servings: number
  imageUrl?: string | null
  createdAt: string
  updatedAt: string
  ingredients: RecipeIngredient[]
  totalMacros: Macros
  perServingMacros: Macros
}

export type RecipeIngredientInput = {
  productId?: string | null
  name: string
  amount: number
  unit: string
  kcal: number
  protein: number
  carbs: number
  fat: number
  imageUrl?: string | null
}

export type UpsertRecipeRequest = {
  title: string
  notes?: string | null
  servings: number
  imageUrl?: string | null
  ingredients: RecipeIngredientInput[]
}

export type Product = {
  id: string
  name: string
  brand?: string | null
  barcode?: string | null
  kcalPer100g: number
  proteinPer100g: number
  carbsPer100g: number
  fatPer100g: number
  source: string
}

/** 1 = Madpakke, 2 = Aftensmad */
export type MealType = 1 | 2

export type MealPlanEntry = {
  id: string
  date: string
  mealType: MealType
  recipeId: string
  recipeTitle: string
  servings: number
  days: number
  macros?: Macros | null
  recipeImageUrl?: string | null
}

export type MealPlan = {
  id: string
  weekStart: string
  createdAt: string
  entries: MealPlanEntry[]
}

export type ShoppingItem = {
  id: string
  name: string
  amount: number
  unit: string
  checked: boolean
}

export type ShoppingList = {
  id: string
  mealPlanId?: string | null
  title: string
  createdAt: string
  items: ShoppingItem[]
}

export const MEAL_TYPES: MealType[] = [1, 2]

export const MEAL_LABELS: Record<MealType, string> = {
  1: 'Madpakke',
  2: 'Aftensmad',
}
