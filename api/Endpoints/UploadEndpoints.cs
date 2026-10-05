using Madplan.Api.Services;

namespace Madplan.Api.Endpoints;

public static class UploadEndpoints
{
    public static RouteGroupBuilder MapUploadEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/uploads").WithTags("Uploads");

        group.MapPost("/", async (HttpRequest request, ObjectStorageService storage) =>
        {
            if (!request.HasFormContentType)
                return Results.BadRequest(new { error = "Forventede multipart/form-data." });

            var form = await request.ReadFormAsync();
            var file = form.Files.GetFile("file") ?? form.Files.FirstOrDefault();
            if (file is null || file.Length == 0)
                return Results.BadRequest(new { error = "Ingen fil modtaget." });

            if (file.Length > 12 * 1024 * 1024)
                return Results.BadRequest(new { error = "Filen må højst være 12 MB." });

            var folder = form["folder"].ToString();
            if (string.IsNullOrWhiteSpace(folder)) folder = "uploads";

            try
            {
                await using var stream = file.OpenReadStream();
                var (url, key) = await storage.UploadAsync(stream, file.ContentType, file.FileName, folder);
                return Results.Ok(new { url, key });
            }
            catch (ArgumentException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
            catch (InvalidOperationException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });

        return group;
    }
}
