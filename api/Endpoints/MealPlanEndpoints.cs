using Madplan.Api.Data;
using Madplan.Api.Models;
using Madplan.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace Madplan.Api.Endpoints;

public static class MealPlanEndpoints
{
    public static RouteGroupBuilder MapMealPlanEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/meal-plans").WithTags("MealPlans");

        group.MapGet("/", async (DateOnly? weekStart, AppDbContext db) =>
        {
            IQueryable<MealPlan> query = db.MealPlans
                .Include(m => m.Entries).ThenInclude(e => e.Recipe!).ThenInclude(r => r.Ingredients);

            if (weekStart.HasValue)
            {
                var monday = ToMonday(weekStart.Value);
                query = query.Where(m => m.WeekStart == monday);
            }

            var plans = await query.OrderByDescending(m => m.WeekStart).ToListAsync();
            return Results.Ok(plans.Select(MapPlan));
        });

        group.MapGet("/{id:guid}", async (Guid id, AppDbContext db) =>
        {
            var plan = await db.MealPlans
                .Include(m => m.Entries).ThenInclude(e => e.Recipe!).ThenInclude(r => r.Ingredients)
                .FirstOrDefaultAsync(m => m.Id == id);
            return plan is null ? Results.NotFound() : Results.Ok(MapPlan(plan));
        });

        group.MapPost("/", async (CreateMealPlanRequest request, AppDbContext db) =>
        {
            var monday = ToMonday(request.WeekStart);
            var existing = await db.MealPlans
                .Include(m => m.Entries).ThenInclude(e => e.Recipe!).ThenInclude(r => r.Ingredients)
                .FirstOrDefaultAsync(m => m.WeekStart == monday);
            if (existing is not null)
                return Results.Ok(MapPlan(existing));

            var plan = new MealPlan { WeekStart = monday };
            db.MealPlans.Add(plan);
            await db.SaveChangesAsync();
            return Results.Created($"/api/meal-plans/{plan.Id}", MapPlan(plan));
        });

        group.MapPost("/{id:guid}/entries", async (Guid id, UpsertMealPlanEntryRequest request, AppDbContext db) =>
        {
            var plan = await db.MealPlans
                .Include(m => m.Entries).ThenInclude(e => e.Recipe!).ThenInclude(r => r.Ingredients)
                .FirstOrDefaultAsync(m => m.Id == id);
            if (plan is null) return Results.NotFound();

            if (request.MealType is not (MealType.Madpakke or MealType.Aftensmad))
                return Results.BadRequest(new { error = "Kun madpakke og aftensmad er tilladt." });

            var recipe = await db.Recipes.Include(r => r.Ingredients).FirstOrDefaultAsync(r => r.Id == request.RecipeId);
            if (recipe is null) return Results.BadRequest(new { error = "Ret findes ikke." });

            var entry = new MealPlanEntry
            {
                MealPlanId = id,
                Date = request.Date,
                MealType = request.MealType,
                RecipeId = request.RecipeId,
                Recipe = recipe,
                Servings = Math.Max(0.5, request.Servings),
                Days = Math.Clamp(request.Days, 1, 14)
            };
            db.MealPlanEntries.Add(entry);
            await db.SaveChangesAsync();

            await db.Entry(entry).Reference(e => e.Recipe).LoadAsync();
            if (entry.Recipe is not null)
                await db.Entry(entry.Recipe).Collection(r => r.Ingredients).LoadAsync();

            return Results.Created($"/api/meal-plans/{id}/entries/{entry.Id}", MapEntry(entry));
        });

        group.MapPut("/{planId:guid}/entries/{entryId:guid}", async (
            Guid planId, Guid entryId, UpsertMealPlanEntryRequest request, AppDbContext db) =>
        {
            var entry = await db.MealPlanEntries
                .Include(e => e.Recipe!).ThenInclude(r => r.Ingredients)
                .FirstOrDefaultAsync(e => e.Id == entryId && e.MealPlanId == planId);
            if (entry is null) return Results.NotFound();

            if (request.MealType is not (MealType.Madpakke or MealType.Aftensmad))
                return Results.BadRequest(new { error = "Kun madpakke og aftensmad er tilladt." });

            var recipeExists = await db.Recipes.AnyAsync(r => r.Id == request.RecipeId);
            if (!recipeExists) return Results.BadRequest(new { error = "Ret findes ikke." });

            entry.Date = request.Date;
            entry.MealType = request.MealType;
            entry.RecipeId = request.RecipeId;
            entry.Servings = Math.Max(0.5, request.Servings);
            entry.Days = Math.Clamp(request.Days, 1, 14);
            await db.SaveChangesAsync();

            await db.Entry(entry).Reference(e => e.Recipe).LoadAsync();
            if (entry.Recipe is not null)
                await db.Entry(entry.Recipe).Collection(r => r.Ingredients).LoadAsync();

            return Results.Ok(MapEntry(entry));
        });

        group.MapDelete("/{planId:guid}/entries/{entryId:guid}", async (Guid planId, Guid entryId, AppDbContext db) =>
        {
            var entry = await db.MealPlanEntries.FirstOrDefaultAsync(e => e.Id == entryId && e.MealPlanId == planId);
            if (entry is null) return Results.NotFound();
            db.MealPlanEntries.Remove(entry);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        return group;
    }

    public static DateOnly ToMonday(DateOnly date)
    {
        var diff = ((int)date.DayOfWeek + 6) % 7; // Monday=0
        return date.AddDays(-diff);
    }

    private static MealPlanDto MapPlan(MealPlan plan) =>
        new(plan.Id, plan.WeekStart, plan.CreatedAt,
            plan.Entries.OrderBy(e => e.Date).ThenBy(e => e.MealType).Select(MapEntry).ToList());

    private static MealPlanEntryDto MapEntry(MealPlanEntry entry)
    {
        MacrosDto? macros = null;
        if (entry.Recipe is not null)
        {
            var total = MacroCalculator.FromIngredients(entry.Recipe.Ingredients);
            var scale = entry.Servings / Math.Max(1, entry.Recipe.Servings);
            macros = MacroCalculator.ToDto(total.Scale(scale));
        }

        return new MealPlanEntryDto(
            entry.Id,
            entry.Date,
            entry.MealType,
            entry.RecipeId,
            entry.Recipe?.Title ?? "",
            entry.Servings,
            Math.Max(1, entry.Days),
            macros);
    }
}
