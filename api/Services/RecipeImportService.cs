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
    ObjectStorageService storage,
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

    private static readonly Regex OgImageRegex = new(
        @"<meta\b[^>]*(?:property|name)\s*=\s*[""'](?<key>og:image(?:\:secure_url)?|twitter:image)[""'][^>]*content\s*=\s*[""'](?<url>[^""']+)[""']|<meta\b[^>]*content\s*=\s*[""'](?<url>[^""']+)[""'][^>]*(?:property|name)\s*=\s*[""'](?<key>og:image(?:\:secure_url)?|twitter:image)[""']",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex JsonLdRegex = new(
        @"<script[^>]*type\s*=\s*[""']application/ld\+json[""'][^>]*>(?<json>[\s\S]*?)</script>",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex LinkImageRegex = new(
        @"<link\b[^>]*rel\s*=\s*[""']image_src[""'][^>]*href\s*=\s*[""'](?<url>[^""']+)[""']|<link\b[^>]*href\s*=\s*[""'](?<url>[^""']+)[""'][^>]*rel\s*=\s*[""']image_src[""']",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

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

        var extractedImageUrl = ExtractImageUrl(html, uri);

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
                    - imageUrl: absolut http(s) URL til hovedbilledet hvis det fremgår i teksten; ellers null (appen finder ofte også og:image selv).
                    - Medtag kun rigtige opskriftsingredienser (ikke reklamer/navigation).
                    - Gæt ikke vilde værdier; hold estimater konservative.
                    """
                },
                new
                {
                    role = "user",
                    content = string.IsNullOrWhiteSpace(extractedImageUrl)
                        ? $"Ekstrahér opskriften fra denne side.\nURL: {uri}\n\nTekst:\n{pageText}"
                        : $"Ekstrahér opskriften fra denne side.\nURL: {uri}\nFundet sidebillede: {extractedImageUrl}\n\nTekst:\n{pageText}"
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

        var candidateImage = FirstPublicImageUrl(extractedImageUrl, parsed.ImageUrl);
        var imageUrl = await PersistImageAsync(candidateImage, ct);

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

    private async Task<string?> PersistImageAsync(string? imageUrl, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(imageUrl)) return null;
        if (!Uri.TryCreate(imageUrl.Trim(), UriKind.Absolute, out var imgUri) ||
            (imgUri.Scheme != Uri.UriSchemeHttp && imgUri.Scheme != Uri.UriSchemeHttps))
            return null;

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, imgUri);
            request.Headers.Accept.ParseAdd("image/*,*/*");
            using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning("Image download failed {Status} for {Url}", response.StatusCode, imgUri);
                return imgUri.ToString();
            }

            var contentType = response.Content.Headers.ContentType?.MediaType ?? GuessContentType(imgUri);
            contentType = NormalizeImageContentType(contentType);
            if (contentType is null)
            {
                logger.LogWarning("Unsupported image content-type for {Url}", imgUri);
                return imgUri.ToString();
            }

            await using var remote = await response.Content.ReadAsStreamAsync(ct);
            await using var buffer = new MemoryStream();
            await remote.CopyToAsync(buffer, ct);
            if (buffer.Length is 0 or > 12 * 1024 * 1024)
                return imgUri.ToString();

            buffer.Position = 0;
            var fileName = Path.GetFileName(imgUri.LocalPath);
            if (string.IsNullOrWhiteSpace(fileName) || fileName.Length > 80)
                fileName = "recipe" + ExtensionFor(contentType);

            var (url, _) = await storage.UploadAsync(buffer, contentType, fileName, "recipes", ct);
            return url;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Could not persist recipe image {Url}", imgUri);
            return imgUri.ToString();
        }
    }

    private static string? FirstPublicImageUrl(params string?[] candidates)
    {
        foreach (var candidate in candidates)
        {
            if (string.IsNullOrWhiteSpace(candidate)) continue;
            if (Uri.TryCreate(candidate.Trim(), UriKind.Absolute, out var uri) &&
                (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps))
                return uri.ToString();
        }

        return null;
    }

    private static string? ExtractImageUrl(string html, Uri pageUri)
    {
        foreach (Match match in OgImageRegex.Matches(html))
        {
            var resolved = ResolveUrl(match.Groups["url"].Value, pageUri);
            if (resolved is not null) return resolved;
        }

        foreach (Match match in LinkImageRegex.Matches(html))
        {
            var resolved = ResolveUrl(match.Groups["url"].Value, pageUri);
            if (resolved is not null) return resolved;
        }

        foreach (Match match in JsonLdRegex.Matches(html))
        {
            var json = WebUtility.HtmlDecode(match.Groups["json"].Value.Trim());
            if (string.IsNullOrWhiteSpace(json)) continue;

            try
            {
                using var doc = JsonDocument.Parse(json);
                var found = FindRecipeImage(doc.RootElement);
                var resolved = ResolveUrl(found, pageUri);
                if (resolved is not null) return resolved;
            }
            catch (JsonException)
            {
                // ignore malformed ld+json blocks
            }
        }

        return null;
    }

    private static string? FindRecipeImage(JsonElement element)
    {
        if (element.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in element.EnumerateArray())
            {
                var found = FindRecipeImage(item);
                if (found is not null) return found;
            }

            return null;
        }

        if (element.ValueKind != JsonValueKind.Object)
            return null;

        var isRecipe = false;
        if (element.TryGetProperty("@type", out var typeEl))
            isRecipe = IsRecipeType(typeEl);

        if (isRecipe && element.TryGetProperty("image", out var imageEl))
        {
            var fromImage = ImageFromJson(imageEl);
            if (fromImage is not null) return fromImage;
        }

        if (element.TryGetProperty("@graph", out var graph))
        {
            var fromGraph = FindRecipeImage(graph);
            if (fromGraph is not null) return fromGraph;
        }

        // Fallback: any image on a Recipe-like object, or top-level image
        if (element.TryGetProperty("image", out var anyImage))
        {
            var fromAny = ImageFromJson(anyImage);
            if (fromAny is not null && isRecipe) return fromAny;
        }

        foreach (var prop in element.EnumerateObject())
        {
            if (prop.Value.ValueKind is JsonValueKind.Object or JsonValueKind.Array)
            {
                var nested = FindRecipeImage(prop.Value);
                if (nested is not null) return nested;
            }
        }

        return null;
    }

    private static bool IsRecipeType(JsonElement typeEl) => typeEl.ValueKind switch
    {
        JsonValueKind.String => typeEl.GetString()?.Contains("Recipe", StringComparison.OrdinalIgnoreCase) == true,
        JsonValueKind.Array => typeEl.EnumerateArray().Any(t =>
            t.ValueKind == JsonValueKind.String &&
            t.GetString()?.Contains("Recipe", StringComparison.OrdinalIgnoreCase) == true),
        _ => false
    };

    private static string? ImageFromJson(JsonElement imageEl)
    {
        switch (imageEl.ValueKind)
        {
            case JsonValueKind.String:
                return imageEl.GetString();
            case JsonValueKind.Array:
                foreach (var item in imageEl.EnumerateArray())
                {
                    var found = ImageFromJson(item);
                    if (found is not null) return found;
                }

                return null;
            case JsonValueKind.Object:
                if (imageEl.TryGetProperty("url", out var url) && url.ValueKind == JsonValueKind.String)
                    return url.GetString();
                if (imageEl.TryGetProperty("@id", out var id) && id.ValueKind == JsonValueKind.String)
                    return id.GetString();
                if (imageEl.TryGetProperty("contentUrl", out var contentUrl) && contentUrl.ValueKind == JsonValueKind.String)
                    return contentUrl.GetString();
                return null;
            default:
                return null;
        }
    }

    private static string? ResolveUrl(string? value, Uri pageUri)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var trimmed = WebUtility.HtmlDecode(value.Trim());
        if (Uri.TryCreate(trimmed, UriKind.Absolute, out var absolute) &&
            (absolute.Scheme == Uri.UriSchemeHttp || absolute.Scheme == Uri.UriSchemeHttps))
            return absolute.ToString();

        if (Uri.TryCreate(pageUri, trimmed, out var relative) &&
            (relative.Scheme == Uri.UriSchemeHttp || relative.Scheme == Uri.UriSchemeHttps))
            return relative.ToString();

        return null;
    }

    private static string GuessContentType(Uri uri)
    {
        var ext = Path.GetExtension(uri.LocalPath).ToLowerInvariant();
        return ext switch
        {
            ".png" => "image/png",
            ".webp" => "image/webp",
            ".gif" => "image/gif",
            ".jpg" or ".jpeg" => "image/jpeg",
            _ => "image/jpeg",
        };
    }

    private static string? NormalizeImageContentType(string? contentType)
    {
        if (string.IsNullOrWhiteSpace(contentType)) return null;
        contentType = contentType.Split(';')[0].Trim().ToLowerInvariant();
        return contentType switch
        {
            "image/jpeg" or "image/jpg" or "image/png" or "image/webp" or "image/gif" => contentType == "image/jpg" ? "image/jpeg" : contentType,
            "application/octet-stream" => "image/jpeg",
            _ => null,
        };
    }

    private static string ExtensionFor(string contentType) => contentType.ToLowerInvariant() switch
    {
        "image/png" => ".png",
        "image/webp" => ".webp",
        "image/gif" => ".gif",
        _ => ".jpg",
    };

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
