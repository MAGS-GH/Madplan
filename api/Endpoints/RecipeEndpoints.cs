using Madplan.Api.Data;
using Madplan.Api.Models;
using Madplan.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace Madplan.Api.Endpoints;

public static class RecipeEndpoints
{
    public static RouteGroupBuilder MapRecipeEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/recipes").WithTags("Recipes");

        group.MapGet("/", async (AppDbContext db) =>
        {
            var recipes = await db.Recipes
                .Include(r => r.Ingredients)
                .OrderByDescending(r => r.UpdatedAt)
                .ToListAsync();
            return Results.Ok(recipes.Select(MapRecipe));
        });

        group.MapGet("/{id:guid}", async (Guid id, AppDbContext db) =>
        {
            var recipe = await db.Recipes.Include(r => r.Ingredients).FirstOrDefaultAsync(r => r.Id == id);
            return recipe is null ? Results.NotFound() : Results.Ok(MapRecipe(recipe));
        });

        group.MapPost("/import-url", async (ImportRecipeUrlRequest request, RecipeImportService importer) =>
        {
            try
            {
                var imported = await importer.ImportFromUrlAsync(request.Url);
                return Results.Ok(imported);
            }
            catch (ArgumentException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
            catch (InvalidOperationException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });

        group.MapPost("/", async (UpsertRecipeRequest request, AppDbContext db) =>
        {
            if (string.IsNullOrWhiteSpace(request.Title))
                return Results.BadRequest(new { error = "Titel er påkrævet." });

            var recipe = new Recipe
            {
                Title = request.Title.Trim(),
                Notes = request.Notes,
                Servings = Math.Max(1, request.Servings),
                ImageUrl = request.ImageUrl,
                Ingredients = request.Ingredients.Select(MapIngredient).ToList()
            };

            db.Recipes.Add(recipe);
            await db.SaveChangesAsync();
            return Results.Created($"/api/recipes/{recipe.Id}", MapRecipe(recipe));
        });

        group.MapPut("/{id:guid}", async (Guid id, UpsertRecipeRequest request, AppDbContext db) =>
        {
            var recipe = await db.Recipes.Include(r => r.Ingredients).FirstOrDefaultAsync(r => r.Id == id);
            if (recipe is null) return Results.NotFound();
            if (string.IsNullOrWhiteSpace(request.Title))
                return Results.BadRequest(new { error = "Titel er påkrævet." });

            recipe.Title = request.Title.Trim();
            recipe.Notes = request.Notes;
            recipe.Servings = Math.Max(1, request.Servings);
            recipe.ImageUrl = request.ImageUrl;
            recipe.UpdatedAt = DateTime.UtcNow;

            // Slet og genindsæt i to trin — ellers får EF concurrency-fejl ved ReplaceRange.
            db.RecipeIngredients.RemoveRange(recipe.Ingredients);
            await db.SaveChangesAsync();

            recipe.Ingredients.Clear();
            foreach (var input in request.Ingredients)
                recipe.Ingredients.Add(MapIngredient(input));

            await db.SaveChangesAsync();
            return Results.Ok(MapRecipe(recipe));
        });

        group.MapDelete("/{id:guid}", async (Guid id, AppDbContext db) =>
        {
            var recipe = await db.Recipes.FindAsync(id);
            if (recipe is null) return Results.NotFound();

            var used = await db.MealPlanEntries.AnyAsync(e => e.RecipeId == id);
            if (used)
                return Results.Conflict(new { error = "Retten bruges i en ugeplan og kan ikke slettes." });

            db.Recipes.Remove(recipe);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        return group;
    }

    private static RecipeIngredient MapIngredient(RecipeIngredientInput i) => new()
    {
        ProductId = i.ProductId,
        Name = i.Name.Trim(),
        Amount = i.Amount,
        Unit = string.IsNullOrWhiteSpace(i.Unit) ? "g" : i.Unit.Trim(),
        ImageUrl = string.IsNullOrWhiteSpace(i.ImageUrl) ? null : i.ImageUrl.Trim(),
        Kcal = i.Kcal,
        Protein = i.Protein,
        Carbs = i.Carbs,
        Fat = i.Fat
    };

    public static RecipeDto MapRecipe(Recipe recipe)
    {
        var total = MacroCalculator.FromIngredients(recipe.Ingredients);
        var servings = Math.Max(1, recipe.Servings);
        var perServing = total.Scale(1.0 / servings);

        return new RecipeDto(
            recipe.Id,
            recipe.Title,
            recipe.Notes,
            recipe.Servings,
            recipe.ImageUrl,
            recipe.CreatedAt,
            recipe.UpdatedAt,
            recipe.Ingredients.Select(i => new RecipeIngredientDto(
                i.Id, i.ProductId, i.Name, i.Amount, i.Unit, i.Kcal, i.Protein, i.Carbs, i.Fat, i.ImageUrl)).ToList(),
            MacroCalculator.ToDto(total),
            MacroCalculator.ToDto(perServing));
    }
}
