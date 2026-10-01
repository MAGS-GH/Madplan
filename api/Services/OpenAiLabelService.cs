using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Madplan.Api.Data;
using Madplan.Api.Models;
using Microsoft.Extensions.Options;

namespace Madplan.Api.Services;

public class OpenAiOptions
{
    public const string SectionName = "OpenAI";
    public string ApiKey { get; set; } = string.Empty;
    public string Model { get; set; } = "gpt-4o-mini";
    public string BaseUrl { get; set; } = "https://api.openai.com/v1/";
}

public class OpenAiLabelService(
    HttpClient http,
    AppDbContext db,
    IOptions<OpenAiOptions> options,
    ILogger<OpenAiLabelService> logger)
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    public async Task<Product?> AnalyzeLabelAsync(Stream imageStream, string contentType, CancellationToken ct = default)
    {
        var opts = options.Value;
        if (string.IsNullOrWhiteSpace(opts.ApiKey))
            throw new InvalidOperationException("OpenAI API-nøgle mangler (OpenAI__ApiKey).");

        await using var ms = new MemoryStream();
        await imageStream.CopyToAsync(ms, ct);
        var base64 = Convert.ToBase64String(ms.ToArray());
        var mediaType = string.IsNullOrWhiteSpace(contentType) ? "image/jpeg" : contentType;
        var dataUrl = $"data:{mediaType};base64,{base64}";

        var requestBody = new
        {
            model = opts.Model,
            temperature = 0.1,
            response_format = new { type = "json_object" },
            messages = new object[]
            {
                new
                {
                    role = "system",
                    content = """
                    Du udlæser danske/engelske indholdsdeklarationer (næringsindhold) fra billeder.
                    Returnér KUN JSON med felterne:
                    name (string), brand (string|null),
                    kcalPer100g (number), proteinPer100g (number), carbsPer100g (number), fatPer100g (number).
                    Brug 0 hvis et felt ikke kan læses. Gæt ikke vilde værdier.
                    """
                },
                new
                {
                    role = "user",
                    content = new object[]
                    {
                        new { type = "text", text = "Læs næringsindhold pr. 100 g/ml fra dette label." },
                        new { type = "image_url", image_url = new { url = dataUrl } }
                    }
                }
            }
        };

        using var request = new HttpRequestMessage(HttpMethod.Post, "chat/completions");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", opts.ApiKey);
        request.Content = new StringContent(JsonSerializer.Serialize(requestBody), Encoding.UTF8, "application/json");

        using var response = await http.SendAsync(request, ct);
        var raw = await response.Content.ReadAsStringAsync(ct);
        if (!response.IsSuccessStatusCode)
        {
            logger.LogError("OpenAI error {Status}: {Body}", response.StatusCode, raw);
            throw new InvalidOperationException("OpenAI kunne ikke analysere billedet.");
        }

        var completion = JsonSerializer.Deserialize<ChatCompletionResponse>(raw, JsonOptions);
        var content = completion?.Choices?.FirstOrDefault()?.Message?.Content;
        if (string.IsNullOrWhiteSpace(content))
            throw new InvalidOperationException("Tomt svar fra OpenAI.");

        var parsed = JsonSerializer.Deserialize<LabelParseResult>(content, JsonOptions)
                     ?? throw new InvalidOperationException("Kunne ikke parse OpenAI JSON.");

        var product = new Product
        {
            Name = string.IsNullOrWhiteSpace(parsed.Name) ? "Ukendt produkt" : parsed.Name.Trim(),
            Brand = string.IsNullOrWhiteSpace(parsed.Brand) ? null : parsed.Brand.Trim(),
            KcalPer100g = parsed.KcalPer100g,
            ProteinPer100g = parsed.ProteinPer100g,
            CarbsPer100g = parsed.CarbsPer100g,
            FatPer100g = parsed.FatPer100g,
            Source = "openai",
            RawJson = content
        };

        db.Products.Add(product);
        await db.SaveChangesAsync(ct);
        return product;
    }

    private sealed class ChatCompletionResponse
    {
        public List<Choice>? Choices { get; set; }
    }

    private sealed class Choice
    {
        public Message? Message { get; set; }
    }

    private sealed class Message
    {
        public string? Content { get; set; }
    }

    private sealed class LabelParseResult
    {
        public string? Name { get; set; }
        public string? Brand { get; set; }
        public double KcalPer100g { get; set; }
        public double ProteinPer100g { get; set; }
        public double CarbsPer100g { get; set; }
        public double FatPer100g { get; set; }
    }
}
