using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Madplan.Api.Models;
using Microsoft.Extensions.Options;

namespace Madplan.Api.Services;

public class RecipeImportService(
    HttpClient http,
    IOptions<OpenAiOptions> options,
    ILogger<RecipeImportService> logger)
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    private static readonly Regex ScriptStyleRegex = new(
        @"<(script|style)[^>]*>[\s\S]*?</\1>",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex TagRegex = new(@"<[^>]+>", RegexOptions.Compiled);
    private static readonly Regex WhitespaceRegex = new(@"\s+", RegexOptions.Compiled);

    public async Task<UpsertRecipeRequest> ImportFromUrlAsync(string url, CancellationToken ct = default)
    {
        var opts = options.Value;
        if (string.IsNullOrWhiteSpace(opts.ApiKey))
            throw new InvalidOperationException("OpenAI API-nøgle mangler (OpenAI__ApiKey).");

        if (!TryValidatePublicHttpUrl(url, out var uri, out var error))
            throw new ArgumentException(error);

        string html;
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, uri);
            request.Headers.Accept.ParseAdd("text/html,application/xhtml+xml");
            using var response = await http.SendAsync(request, ct);
            if (!response.IsSuccessStatusCode)
                throw new InvalidOperationException($"Siden svarede med {(int)response.StatusCode}.");

            html = await response.Content.ReadAsStringAsync(ct);
        }
        catch (Exception ex) when (ex is not InvalidOperationException and not ArgumentException)
        {
            logger.LogWarning(ex, "Kunne ikke hente {Url}", uri);
            throw new InvalidOperationException("Kunne ikke hente siden. Tjek URL'en.");
        }

        if (string.IsNullOrWhiteSpace(html))
            throw new InvalidOperationException("Siden var tom.");

        var pageText = HtmlToText(html);
        if (pageText.Length < 40)
            throw new InvalidOperationException("Kunne ikke finde læsbar opskriftstekst på siden.");

        if (pageText.Length > 45000)
            pageText = pageText[..45000];

        var baseUrl = string.IsNullOrWhiteSpace(opts.BaseUrl) ? "https://api.openai.com/v1/" : opts.BaseUrl;
        if (!baseUrl.EndsWith('/')) baseUrl += "/";

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
                    Du eksporterer madopskrifter fra websidetekst til struktureret JSON til en dansk madplans-app.
                    Returnér KUN JSON med felterne:
                    {
                      "title": string,
                      "servings": number,
                      "imageUrl": string|null,
                      "notes": string,
                      "ingredients": [
                        {
                          "name": string,
                          "amount": number,
                          "unit": string,
                          "kcal": number,
                          "protein": number,
                          "carbs": number,
                          "fat": number
                        }
                      ]
                    }

                    Regler:
                    - Skriv på dansk.
                    - servings = antal portioner eller stk. som opskriften angiver (fx 10 pandekager → 10).
                    - notes skal indeholde kort intro, fremgangsmåde i nummererede trin, og kilden (URL) nederst.
                    - amount skal være tal (brug 0.5 ikke "½"). unit på dansk: g, dl, ml, stk, tsk, spsk, nip, osv.
                    - Makroer er for den angivne mængde af hver ingrediens (ikke pr. 100 g).
                    - Hvis siden mangler makroer, estimér realistisk fra typiske danske værdier. Brug 0 hvis helt ukendt.
                    - imageUrl: absolut http(s) URL hvis et opskriftsbillede fremgår; ellers null.
                    - Medtag kun rigtige opskriftsingredienser (ikke reklamer/navigation).
                    - Gæt ikke vilde værdier; hold estimater konservative.
                    """
                },
                new
                {
                    role = "user",
                    content = $"Ekstrahér opskriften fra denne side.\nURL: {uri}\n\nTekst:\n{pageText}"
                }
            }
        };

        using var aiRequest = new HttpRequestMessage(HttpMethod.Post, new Uri(new Uri(baseUrl), "chat/completions"));
        aiRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", opts.ApiKey);
        aiRequest.Content = new StringContent(JsonSerializer.Serialize(requestBody), Encoding.UTF8, "application/json");

        using var aiResponse = await http.SendAsync(aiRequest, ct);
        var raw = await aiResponse.Content.ReadAsStringAsync(ct);
        if (!aiResponse.IsSuccessStatusCode)
        {
            logger.LogError("OpenAI recipe import error {Status}: {Body}", aiResponse.StatusCode, raw);
            throw new InvalidOperationException("AI kunne ikke læse opskriften.");
        }

        var completion = JsonSerializer.Deserialize<ChatCompletionResponse>(raw, JsonOptions);
        var content = completion?.Choices?.FirstOrDefault()?.Message?.Content;
        if (string.IsNullOrWhiteSpace(content))
            throw new InvalidOperationException("Tomt svar fra AI.");

        var parsed = JsonSerializer.Deserialize<ImportedRecipe>(content, JsonOptions)
                     ?? throw new InvalidOperationException("Kunne ikke parse AI-svar.");

        if (string.IsNullOrWhiteSpace(parsed.Title))
            throw new InvalidOperationException("AI fandt ingen titel på opskriften.");

        var ingredients = (parsed.Ingredients ?? [])
            .Where(i => !string.IsNullOrWhiteSpace(i.Name))
            .Select(i => new RecipeIngredientInput(
                null,
                i.Name!.Trim(),
                i.Amount <= 0 ? 1 : i.Amount,
                string.IsNullOrWhiteSpace(i.Unit) ? "g" : i.Unit.Trim(),
                Math.Max(0, i.Kcal),
                Math.Max(0, i.Protein),
                Math.Max(0, i.Carbs),
                Math.Max(0, i.Fat)))
            .ToList();

        if (ingredients.Count == 0)
            throw new InvalidOperationException("AI fandt ingen ingredienser.");

        var notes = parsed.Notes?.Trim() ?? "";
        if (!notes.Contains(uri.ToString(), StringComparison.OrdinalIgnoreCase))
            notes = string.IsNullOrWhiteSpace(notes)
                ? $"Kilde: {uri}"
                : $"{notes.TrimEnd()}\n\nKilde: {uri}";

        string? imageUrl = null;
        if (!string.IsNullOrWhiteSpace(parsed.ImageUrl) &&
            Uri.TryCreate(parsed.ImageUrl, UriKind.Absolute, out var imgUri) &&
            (imgUri.Scheme == Uri.UriSchemeHttp || imgUri.Scheme == Uri.UriSchemeHttps))
        {
            imageUrl = imgUri.ToString();
        }

        return new UpsertRecipeRequest(
            parsed.Title.Trim(),
            notes,
            Math.Max(1, parsed.Servings <= 0 ? 2 : (int)Math.Round(parsed.Servings)),
            imageUrl,
            ingredients);
    }

    public static bool TryValidatePublicHttpUrl(string? url, out Uri uri, out string error)
    {
        uri = default!;
        error = "";
        if (string.IsNullOrWhiteSpace(url))
        {
            error = "URL er påkrævet.";
            return false;
        }

        if (!Uri.TryCreate(url.Trim(), UriKind.Absolute, out uri!) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
        {
            error = "Angiv en gyldig http(s)-adresse.";
            return false;
        }

        var host = uri.Host;
        if (string.Equals(host, "localhost", StringComparison.OrdinalIgnoreCase) ||
            host is "127.0.0.1" or "::1" ||
            host.EndsWith(".local", StringComparison.OrdinalIgnoreCase) ||
            host.StartsWith("10.", StringComparison.Ordinal) ||
            host.StartsWith("192.168.", StringComparison.Ordinal) ||
            Regex.IsMatch(host, @"^172\.(1[6-9]|2\d|3[0-1])\."))
        {
            error = "URL'en peger på et privat netværk og er ikke tilladt.";
            return false;
        }

        return true;
    }

    private static string HtmlToText(string html)
    {
        html = ScriptStyleRegex.Replace(html, " ");
        html = TagRegex.Replace(html, " ");
        html = WebUtility.HtmlDecode(html);
        return WhitespaceRegex.Replace(html, " ").Trim();
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

    private sealed class ImportedRecipe
    {
        public string? Title { get; set; }
        public double Servings { get; set; }
        public string? ImageUrl { get; set; }
        public string? Notes { get; set; }
        public List<ImportedIngredient>? Ingredients { get; set; }
    }

    private sealed class ImportedIngredient
    {
        public string? Name { get; set; }
        public double Amount { get; set; }
        public string? Unit { get; set; }
        public double Kcal { get; set; }
        public double Protein { get; set; }
        public double Carbs { get; set; }
        public double Fat { get; set; }
    }
}
