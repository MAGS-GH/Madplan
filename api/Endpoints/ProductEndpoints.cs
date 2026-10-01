using Madplan.Api.Data;
using Madplan.Api.Models;
using Madplan.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace Madplan.Api.Endpoints;

public static class ProductEndpoints
{
    public static RouteGroupBuilder MapProductEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/products").WithTags("Products");

        group.MapGet("/", async (AppDbContext db) =>
        {
            var products = await db.Products.OrderByDescending(p => p.CreatedAt).Take(100).ToListAsync();
            return Results.Ok(products.Select(MapProduct));
        });

        group.MapGet("/{id:guid}", async (Guid id, AppDbContext db) =>
        {
            var product = await db.Products.FindAsync(id);
            return product is null ? Results.NotFound() : Results.Ok(MapProduct(product));
        });

        group.MapGet("/barcode/{code}", async (string code, OpenFoodFactsService off) =>
        {
            var product = await off.LookupBarcodeAsync(code);
            return product is null
                ? Results.NotFound(new { error = "Produktet blev ikke fundet i Open Food Facts." })
                : Results.Ok(MapProduct(product));
        });

        group.MapPost("/label-scan", async (HttpRequest request, OpenAiLabelService openAi) =>
        {
            if (!request.HasFormContentType)
                return Results.BadRequest(new { error = "Forventede multipart/form-data med feltet 'image'." });

            var form = await request.ReadFormAsync();
            var file = form.Files.GetFile("image");
            if (file is null || file.Length == 0)
                return Results.BadRequest(new { error = "Billede mangler." });

            await using var stream = file.OpenReadStream();
            try
            {
                var product = await openAi.AnalyzeLabelAsync(stream, file.ContentType);
                return Results.Ok(MapProduct(product!));
            }
            catch (InvalidOperationException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        }).DisableAntiforgery();

        group.MapPost("/", async (ProductDto input, AppDbContext db) =>
        {
            if (string.IsNullOrWhiteSpace(input.Name))
                return Results.BadRequest(new { error = "Navn er påkrævet." });

            var product = new Product
            {
                Name = input.Name.Trim(),
                Brand = input.Brand,
                Barcode = input.Barcode,
                KcalPer100g = input.KcalPer100g,
                ProteinPer100g = input.ProteinPer100g,
                CarbsPer100g = input.CarbsPer100g,
                FatPer100g = input.FatPer100g,
                Source = string.IsNullOrWhiteSpace(input.Source) ? "manual" : input.Source
            };
            db.Products.Add(product);
            await db.SaveChangesAsync();
            return Results.Created($"/api/products/{product.Id}", MapProduct(product));
        });

        return group;
    }

    public static ProductDto MapProduct(Product p) =>
        new(p.Id, p.Name, p.Brand, p.Barcode, p.KcalPer100g, p.ProteinPer100g, p.CarbsPer100g, p.FatPer100g, p.Source);
}
