using Madplan.Api.Data;
using Madplan.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace Madplan.Api.Endpoints;

public static class ShoppingEndpoints
{
    public static RouteGroupBuilder MapShoppingEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/shopping-lists").WithTags("Shopping");

        group.MapGet("/", async (AppDbContext db) =>
        {
            var lists = await db.ShoppingLists
                .Include(l => l.Items)
                .OrderByDescending(l => l.CreatedAt)
                .ToListAsync();
            return Results.Ok(lists.Select(MapList));
        });

        group.MapGet("/{id:guid}", async (Guid id, AppDbContext db) =>
        {
            var list = await db.ShoppingLists.Include(l => l.Items).FirstOrDefaultAsync(l => l.Id == id);
            return list is null ? Results.NotFound() : Results.Ok(MapList(list));
        });

        group.MapPost("/from-plan/{mealPlanId:guid}", async (Guid mealPlanId, AppDbContext db) =>
        {
            var plan = await db.MealPlans
                .Include(m => m.Entries).ThenInclude(e => e.Recipe!).ThenInclude(r => r.Ingredients)
                .FirstOrDefaultAsync(m => m.Id == mealPlanId);
            if (plan is null) return Results.NotFound();

            var aggregated = new Dictionary<string, (string Name, double Amount, string Unit)>(StringComparer.OrdinalIgnoreCase);

            foreach (var entry in plan.Entries)
            {
                if (entry.Recipe is null) continue;
                var scale = entry.Servings / Math.Max(1, entry.Recipe.Servings);
                foreach (var ing in entry.Recipe.Ingredients)
                {
                    var key = $"{ing.Name.Trim().ToLowerInvariant()}|{ing.Unit.Trim().ToLowerInvariant()}";
                    if (aggregated.TryGetValue(key, out var existing))
                    {
                        aggregated[key] = (existing.Name, existing.Amount + ing.Amount * scale, existing.Unit);
                    }
                    else
                    {
                        aggregated[key] = (ing.Name.Trim(), ing.Amount * scale, ing.Unit);
                    }
                }
            }

            var list = new ShoppingList
            {
                MealPlanId = mealPlanId,
                Title = $"Indkøb uge {plan.WeekStart:dd/MM}",
                Items = aggregated.Values
                    .OrderBy(v => v.Name)
                    .Select(v => new ShoppingItem
                    {
                        Name = v.Name,
                        Amount = Math.Round(v.Amount, 1),
                        Unit = v.Unit
                    }).ToList()
            };

            db.ShoppingLists.Add(list);
            await db.SaveChangesAsync();
            return Results.Created($"/api/shopping-lists/{list.Id}", MapList(list));
        });

        group.MapPost("/{id:guid}/items", async (Guid id, CreateShoppingItemRequest request, AppDbContext db) =>
        {
            var list = await db.ShoppingLists.Include(l => l.Items).FirstOrDefaultAsync(l => l.Id == id);
            if (list is null) return Results.NotFound();
            if (string.IsNullOrWhiteSpace(request.Name))
                return Results.BadRequest(new { error = "Navn er påkrævet." });

            var item = new ShoppingItem
            {
                ShoppingListId = id,
                Name = request.Name.Trim(),
                Amount = request.Amount,
                Unit = string.IsNullOrWhiteSpace(request.Unit) ? "stk" : request.Unit.Trim()
            };
            db.ShoppingItems.Add(item);
            await db.SaveChangesAsync();
            return Results.Created($"/api/shopping-lists/{id}/items/{item.Id}", MapItem(item));
        });

        group.MapPatch("/{listId:guid}/items/{itemId:guid}", async (
            Guid listId, Guid itemId, UpdateShoppingItemRequest request, AppDbContext db) =>
        {
            var item = await db.ShoppingItems.FirstOrDefaultAsync(i => i.Id == itemId && i.ShoppingListId == listId);
            if (item is null) return Results.NotFound();

            if (request.Name is not null) item.Name = request.Name.Trim();
            if (request.Amount.HasValue) item.Amount = request.Amount.Value;
            if (request.Unit is not null) item.Unit = request.Unit.Trim();
            if (request.Checked.HasValue) item.Checked = request.Checked.Value;

            await db.SaveChangesAsync();
            return Results.Ok(MapItem(item));
        });

        group.MapDelete("/{listId:guid}/items/{itemId:guid}", async (Guid listId, Guid itemId, AppDbContext db) =>
        {
            var item = await db.ShoppingItems.FirstOrDefaultAsync(i => i.Id == itemId && i.ShoppingListId == listId);
            if (item is null) return Results.NotFound();
            db.ShoppingItems.Remove(item);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        group.MapDelete("/{id:guid}", async (Guid id, AppDbContext db) =>
        {
            var list = await db.ShoppingLists.FindAsync(id);
            if (list is null) return Results.NotFound();
            db.ShoppingLists.Remove(list);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        return group;
    }

    private static ShoppingListDto MapList(ShoppingList list) =>
        new(list.Id, list.MealPlanId, list.Title, list.CreatedAt,
            list.Items.OrderBy(i => i.Checked).ThenBy(i => i.Name).Select(MapItem).ToList());

    private static ShoppingItemDto MapItem(ShoppingItem item) =>
        new(item.Id, item.Name, item.Amount, item.Unit, item.Checked);
}
