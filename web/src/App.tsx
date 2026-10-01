import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { MealPlanPage } from './pages/MealPlanPage'
import { RecipeEditPage } from './pages/RecipeEditPage'
import { RecipesPage } from './pages/RecipesPage'
import { ScanPage } from './pages/ScanPage'
import { ShoppingPage } from './pages/ShoppingPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<MealPlanPage />} />
          <Route path="retter" element={<RecipesPage />} />
          <Route path="retter/ny" element={<RecipeEditPage />} />
          <Route path="retter/:id" element={<RecipeEditPage />} />
          <Route path="indkoeb" element={<ShoppingPage />} />
          <Route path="scan" element={<ScanPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
