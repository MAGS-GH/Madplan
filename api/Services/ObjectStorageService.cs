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

public class ObjectStorageService
{
    private static readonly HashSet<string> AllowedContentTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/webp",
        "image/gif",
    };

    private readonly S3Options _options;
    private readonly ILogger<ObjectStorageService> _logger;
    private readonly SemaphoreSlim _initLock = new(1, 1);
    private bool _bucketReady;

    public ObjectStorageService(IOptions<S3Options> options, ILogger<ObjectStorageService> logger)
    {
        _options = options.Value;
        _logger = logger;
    }

    public async Task EnsureBucketAsync(CancellationToken ct = default)
    {
        if (_bucketReady) return;
        await _initLock.WaitAsync(ct);
        try
        {
            if (_bucketReady) return;
            using var client = CreateClient();
            var exists = await Amazon.S3.Util.AmazonS3Util.DoesS3BucketExistV2Async(client, _options.Bucket);
            if (!exists)
            {
                await client.PutBucketAsync(new PutBucketRequest { BucketName = _options.Bucket }, ct);
                _logger.LogInformation("Created S3 bucket {Bucket}", _options.Bucket);
            }

            try
            {
                var policy = $$"""
                    {
                      "Version": "2012-10-17",
                      "Statement": [
                        {
                          "Effect": "Allow",
                          "Principal": { "AWS": ["*"] },
                          "Action": ["s3:GetObject"],
                          "Resource": ["arn:aws:s3:::{{_options.Bucket}}/*"]
                        }
                      ]
                    }
                    """;

                await client.PutBucketPolicyAsync(new PutBucketPolicyRequest
                {
                    BucketName = _options.Bucket,
                    Policy = policy,
                }, ct);
            }
            catch (Exception policyEx)
            {
                // MinIO kan afvise anonyme policies afhængigt af version — upload skal stadig virke.
                _logger.LogWarning(policyEx, "Could not set public read policy on bucket {Bucket}", _options.Bucket);
            }

            _bucketReady = true;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not ensure S3 bucket {Bucket}", _options.Bucket);
            throw;
        }
        finally
        {
            _initLock.Release();
        }
    }

    public async Task<(string Url, string Key)> UploadAsync(
        Stream stream,
        string contentType,
        string? fileName,
        string folder,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(_options.Endpoint) ||
            string.IsNullOrWhiteSpace(_options.AccessKey) ||
            string.IsNullOrWhiteSpace(_options.SecretKey) ||
            string.IsNullOrWhiteSpace(_options.Bucket))
        {
            throw new InvalidOperationException("S3-lager er ikke konfigureret.");
        }

        contentType = string.IsNullOrWhiteSpace(contentType) ? "application/octet-stream" : contentType;
        if (!AllowedContentTypes.Contains(contentType))
            throw new ArgumentException("Kun JPEG, PNG, WebP og GIF er tilladt.");

        await EnsureBucketAsync(ct);

        var ext = ExtensionFor(contentType, fileName);
        var safeFolder = string.IsNullOrWhiteSpace(folder)
            ? "uploads"
            : folder.Trim().Trim('/').Replace('\\', '/');
        var key = $"{safeFolder}/{Guid.NewGuid():N}{ext}";

        using var client = CreateClient();
        try
        {
            await client.PutObjectAsync(new PutObjectRequest
            {
                BucketName = _options.Bucket,
                Key = key,
                InputStream = stream,
                ContentType = contentType,
                AutoCloseStream = false,
            }, ct);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "S3 upload failed for {Key}", key);
            throw new InvalidOperationException("Kunne ikke uploade billedet til lageret.");
        }

        var basePath = string.IsNullOrWhiteSpace(_options.PublicBasePath) ? "/media" : _options.PublicBasePath.TrimEnd('/');
        var url = $"{basePath}/{key}";
        return (url, key);
    }

    private AmazonS3Client CreateClient()
    {
        var config = new AmazonS3Config
        {
            ServiceURL = _options.Endpoint.TrimEnd('/'),
            ForcePathStyle = _options.ForcePathStyle,
            AuthenticationRegion = "us-east-1",
        };
        return new AmazonS3Client(new BasicAWSCredentials(_options.AccessKey, _options.SecretKey), config);
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
