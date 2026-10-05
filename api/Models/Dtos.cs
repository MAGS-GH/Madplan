namespace Madplan.Api.Models;

public record MacrosDto(double Kcal, double Protein, double Carbs, double Fat);

public record RecipeIngredientDto(
    Guid Id,
    Guid? ProductId,
    string Name,
    double Amount,
    string Unit,
    double Kcal,
    double Protein,
    double Carbs,
    double Fat,
    string? ImageUrl);

public record RecipeDto(
    Guid Id,
    string Title,
    string? Notes,
    int Servings,
    string? ImageUrl,
    DateTime CreatedAt,
    DateTime UpdatedAt,
    IReadOnlyList<RecipeIngredientDto> Ingredients,
    MacrosDto TotalMacros,
    MacrosDto PerServingMacros);

public record RecipeIngredientInput(
    Guid? ProductId,
    string Name,
    double Amount,
    string Unit,
    double Kcal,
    double Protein,
    double Carbs,
    double Fat,
    string? ImageUrl = null);

public record UpsertRecipeRequest(
    string Title,
    string? Notes,
    int Servings,
    string? ImageUrl,
    IReadOnlyList<RecipeIngredientInput> Ingredients);

public record ImportRecipeUrlRequest(string Url);

public record ProductDto(
    Guid Id,
    string Name,
    string? Brand,
    string? Barcode,
    double KcalPer100g,
    double ProteinPer100g,
    double CarbsPer100g,
    double FatPer100g,
    string Source);

public record MealPlanEntryDto(
    Guid Id,
    DateOnly Date,
    MealType MealType,
    Guid RecipeId,
    string RecipeTitle,
    double Servings,
    int Days,
    MacrosDto? Macros);

public record MealPlanDto(
    Guid Id,
    DateOnly WeekStart,
    DateTime CreatedAt,
    IReadOnlyList<MealPlanEntryDto> Entries);

public record CreateMealPlanRequest(DateOnly WeekStart);

public record UpsertMealPlanEntryRequest(
    DateOnly Date,
    MealType MealType,
    Guid RecipeId,
    double Servings,
    int Days = 1);

public record ShoppingItemDto(
    Guid Id,
    string Name,
    double Amount,
    string Unit,
    bool Checked);

public record ShoppingListDto(
    Guid Id,
    Guid? MealPlanId,
    string Title,
    DateTime CreatedAt,
    IReadOnlyList<ShoppingItemDto> Items);

public record CreateShoppingItemRequest(string Name, double Amount, string Unit);

public record UpdateShoppingItemRequest(string? Name, double? Amount, string? Unit, bool? Checked);
