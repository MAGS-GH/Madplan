using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.Extensions.Options;

namespace Madplan.Api.Services;

public class S3Options
{
    public const string SectionName = "S3";
    public string Endpoint { get; set; } = "http://minio:9000";
    public string AccessKey { get; set; } = "madplan";
    public string SecretKey { get; set; } = "madplanmadplan";
    public string Bucket { get; set; } = "madplan";
    public string PublicBasePath { get; set; } = "/media";
    public bool ForcePathStyle { get; set; } = true;
}

public class ObjectStorageService(IOptions<S3Options> options, ILogger<ObjectStorageService> logger)
{
    private static readonly HashSet<string> AllowedContentTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/webp",
        "image/gif",
    };

    public async Task<(string Url, string Key)> UploadAsync(
        Stream stream,
        string contentType,
        string? fileName,
        string folder,
        CancellationToken ct = default)
    {
        var opts = options.Value;
        if (string.IsNullOrWhiteSpace(opts.Endpoint) ||
            string.IsNullOrWhiteSpace(opts.AccessKey) ||
            string.IsNullOrWhiteSpace(opts.SecretKey) ||
            string.IsNullOrWhiteSpace(opts.Bucket))
        {
            throw new InvalidOperationException("S3-lager er ikke konfigureret.");
        }

        contentType = string.IsNullOrWhiteSpace(contentType) ? "application/octet-stream" : contentType;
        if (!AllowedContentTypes.Contains(contentType))
            throw new ArgumentException("Kun JPEG, PNG, WebP og GIF er tilladt.");

        var ext = ExtensionFor(contentType, fileName);
        var safeFolder = string.IsNullOrWhiteSpace(folder)
            ? "uploads"
            : folder.Trim().Trim('/').Replace('\\', '/');
        var key = $"{safeFolder}/{Guid.NewGuid():N}{ext}";

        var config = new AmazonS3Config
        {
            ServiceURL = opts.Endpoint.TrimEnd('/'),
            ForcePathStyle = opts.ForcePathStyle,
            AuthenticationRegion = "us-east-1",
        };

        using var client = new AmazonS3Client(
            new BasicAWSCredentials(opts.AccessKey, opts.SecretKey),
            config);

        try
        {
            await client.PutObjectAsync(new PutObjectRequest
            {
                BucketName = opts.Bucket,
                Key = key,
                InputStream = stream,
                ContentType = contentType,
                AutoCloseStream = false,
            }, ct);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "S3 upload failed for {Key}", key);
            throw new InvalidOperationException("Kunne ikke uploade billedet til lageret.");
        }

        var basePath = string.IsNullOrWhiteSpace(opts.PublicBasePath) ? "/media" : opts.PublicBasePath.TrimEnd('/');
        var url = $"{basePath}/{key}";
        return (url, key);
    }

    private static string ExtensionFor(string contentType, string? fileName)
    {
        var fromName = Path.GetExtension(fileName ?? "");
        if (!string.IsNullOrWhiteSpace(fromName) && fromName.Length <= 8)
            return fromName.ToLowerInvariant();

        return contentType.ToLowerInvariant() switch
        {
            "image/png" => ".png",
            "image/webp" => ".webp",
            "image/gif" => ".gif",
            _ => ".jpg",
        };
    }
}
