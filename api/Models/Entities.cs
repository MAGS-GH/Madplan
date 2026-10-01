namespace Madplan.Api.Models;

public class Macros
{
    public double Kcal { get; set; }
    public double Protein { get; set; }
    public double Carbs { get; set; }
    public double Fat { get; set; }

    public static Macros operator +(Macros a, Macros b) => new()
    {
        Kcal = a.Kcal + b.Kcal,
        Protein = a.Protein + b.Protein,
        Carbs = a.Carbs + b.Carbs,
        Fat = a.Fat + b.Fat
    };

    public Macros Scale(double factor) => new()
    {
        Kcal = Kcal * factor,
        Protein = Protein * factor,
        Carbs = Carbs * factor,
        Fat = Fat * factor
    };
}

public class Recipe
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Title { get; set; } = string.Empty;
    public string? Notes { get; set; }
    public int Servings { get; set; } = 2;
    public string? ImageUrl { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public List<RecipeIngredient> Ingredients { get; set; } = [];
}

public class RecipeIngredient
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid RecipeId { get; set; }
    public Recipe? Recipe { get; set; }
    public Guid? ProductId { get; set; }
    public Product? Product { get; set; }
    public string Name { get; set; } = string.Empty;
    public double Amount { get; set; }
    public string Unit { get; set; } = "g";
    /// <summary>Macros for the stated amount (not per 100g).</summary>
    public double Kcal { get; set; }
    public double Protein { get; set; }
    public double Carbs { get; set; }
    public double Fat { get; set; }
}

public class Product
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = string.Empty;
    public string? Brand { get; set; }
    public string? Barcode { get; set; }
    public double KcalPer100g { get; set; }
    public double ProteinPer100g { get; set; }
    public double CarbsPer100g { get; set; }
    public double FatPer100g { get; set; }
    public string Source { get; set; } = "manual"; // openfoodfacts | openai | manual
    public string? RawJson { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public enum MealType
{
    Breakfast = 0,
    Lunch = 1,
    Dinner = 2,
    Snack = 3
}

public class MealPlan
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public DateOnly WeekStart { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public List<MealPlanEntry> Entries { get; set; } = [];
}

public class MealPlanEntry
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid MealPlanId { get; set; }
    public MealPlan? MealPlan { get; set; }
    public DateOnly Date { get; set; }
    public MealType MealType { get; set; }
    public Guid RecipeId { get; set; }
    public Recipe? Recipe { get; set; }
    public double Servings { get; set; } = 2;
}

public class ShoppingList
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid? MealPlanId { get; set; }
    public MealPlan? MealPlan { get; set; }
    public string Title { get; set; } = "Indkøbsliste";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public List<ShoppingItem> Items { get; set; } = [];
}

public class ShoppingItem
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ShoppingListId { get; set; }
    public ShoppingList? ShoppingList { get; set; }
    public string Name { get; set; } = string.Empty;
    public double Amount { get; set; }
    public string Unit { get; set; } = "g";
    public bool Checked { get; set; }
}
