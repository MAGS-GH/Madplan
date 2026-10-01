using Madplan.Api.Models;

namespace Madplan.Api.Services;

public static class MacroCalculator
{
    public static Macros FromIngredients(IEnumerable<RecipeIngredient> ingredients)
    {
        var total = new Macros();
        foreach (var i in ingredients)
        {
            total += new Macros
            {
                Kcal = i.Kcal,
                Protein = i.Protein,
                Carbs = i.Carbs,
                Fat = i.Fat
            };
        }
        return total;
    }

    public static Macros FromPer100g(double amountGrams, double kcal, double protein, double carbs, double fat)
    {
        var factor = amountGrams / 100.0;
        return new Macros
        {
            Kcal = kcal * factor,
            Protein = protein * factor,
            Carbs = carbs * factor,
            Fat = fat * factor
        };
    }

    public static MacrosDto ToDto(Macros m) =>
        new(Round(m.Kcal), Round(m.Protein), Round(m.Carbs), Round(m.Fat));

    private static double Round(double v) => Math.Round(v, 1);
}
