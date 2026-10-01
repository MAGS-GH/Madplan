using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Madplan.Api.Data;
using Madplan.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace Madplan.Api.Services;

public class OpenFoodFactsService(HttpClient http, AppDbContext db, ILogger<OpenFoodFactsService> logger)
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    public async Task<Product?> LookupBarcodeAsync(string barcode, CancellationToken ct = default)
    {
        barcode = barcode.Trim();
        if (string.IsNullOrWhiteSpace(barcode))
            return null;

        var cached = await db.Products.FirstOrDefaultAsync(p => p.Barcode == barcode, ct);
        if (cached is not null)
            return cached;

        try
        {
            using var response = await http.GetAsync($"api/v2/product/{Uri.EscapeDataString(barcode)}", ct);
            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning("Open Food Facts returned {Status} for {Barcode}", response.StatusCode, barcode);
                return null;
            }

            var payload = await response.Content.ReadFromJsonAsync<OffProductResponse>(JsonOptions, ct);
            if (payload is null || payload.Status != 1 || payload.Product is null)
                return null;

            var p = payload.Product;
            var nutriments = p.Nutriments;
            var product = new Product
            {
                Name = FirstNonEmpty(p.ProductNameDa, p.ProductName, p.GenericName) ?? $"Produkt {barcode}",
                Brand = p.Brands,
                Barcode = barcode,
                KcalPer100g = nutriments?.EnergyKcal100g ?? nutriments?.EnergyKcalValue ?? 0,
                ProteinPer100g = nutriments?.Proteins100g ?? 0,
                CarbsPer100g = nutriments?.Carbohydrates100g ?? 0,
                FatPer100g = nutriments?.Fat100g ?? 0,
                Source = "openfoodfacts",
                RawJson = JsonSerializer.Serialize(payload)
            };

            db.Products.Add(product);
            await db.SaveChangesAsync(ct);
            return product;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed looking up barcode {Barcode}", barcode);
            return null;
        }
    }

    private static string? FirstNonEmpty(params string?[] values) =>
        values.FirstOrDefault(v => !string.IsNullOrWhiteSpace(v));

    private sealed class OffProductResponse
    {
        public int Status { get; set; }
        public OffProduct? Product { get; set; }
    }

    private sealed class OffProduct
    {
        [JsonPropertyName("product_name")]
        public string? ProductName { get; set; }

        [JsonPropertyName("product_name_da")]
        public string? ProductNameDa { get; set; }

        [JsonPropertyName("generic_name")]
        public string? GenericName { get; set; }

        public string? Brands { get; set; }
        public OffNutriments? Nutriments { get; set; }
    }

    private sealed class OffNutriments
    {
        [JsonPropertyName("energy-kcal_100g")]
        public double? EnergyKcal100g { get; set; }

        [JsonPropertyName("energy-kcal_value")]
        public double? EnergyKcalValue { get; set; }

        [JsonPropertyName("proteins_100g")]
        public double? Proteins100g { get; set; }

        [JsonPropertyName("carbohydrates_100g")]
        public double? Carbohydrates100g { get; set; }

        [JsonPropertyName("fat_100g")]
        public double? Fat100g { get; set; }
    }
}
