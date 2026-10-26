using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using SentinelOps.Api.Contracts;
using SentinelOps.Api.Domain;
using SentinelOps.Api.Persistence;

namespace SentinelOps.Api.Controllers;

[ApiController]
[Route("api/v1/projects/{projectId}/images")]
[EnableRateLimiting("sync")]
public sealed class ProjectImagesController(SentinelOpsDbContext db, IConfiguration configuration) : ControllerBase
{
    private const long MaxFileSizeBytes = 15 * 1024 * 1024; // 15MB limit
    private static readonly HashSet<string> AllowedMimeTypes =
        ["image/jpeg", "image/jpg", "image/png", "image/webp"];

    // --- Cloudflare R2 Configuration ---
    private string? R2AccountId =>
        configuration["R2:AccountId"]
        ?? configuration["R2__AccountId"]
        ?? configuration["R2_ACCOUNT_ID"];

    private string? R2BucketName =>
        configuration["R2:BucketName"]
        ?? configuration["R2__BucketName"]
        ?? configuration["R2_BUCKET_NAME"]
        ?? "sentinelops-projects";

    private string? R2AccessKeyId =>
        configuration["R2:AccessKeyId"]
        ?? configuration["R2__AccessKeyId"]
        ?? configuration["R2_ACCESS_KEY_ID"];

    private string? R2SecretAccessKey =>
        configuration["R2:SecretAccessKey"]
        ?? configuration["R2__SecretAccessKey"]
        ?? configuration["R2_SECRET_ACCESS_KEY"];

    // --- Cloudinary Backward Compatibility Configuration ---
    private string? CloudinaryCloudName =>
        configuration["Cloudinary:CloudName"]
        ?? configuration["Cloudinary__CloudName"]
        ?? configuration["CLOUDINARY_CLOUD_NAME"];

    private string? CloudinaryApiKey =>
        configuration["Cloudinary:ApiKey"]
        ?? configuration["Cloudinary__ApiKey"]
        ?? configuration["CLOUDINARY_API_KEY"];

    private string? CloudinaryApiSecret =>
        configuration["Cloudinary:ApiSecret"]
        ?? configuration["Cloudinary__ApiSecret"]
        ?? configuration["CLOUDINARY_API_SECRET"];

    // =========================================================================
    // SECTION 6 & 7: CLOUDFLARE R2 PRESIGNED PUT & COMPLETE ENDPOINTS
    // =========================================================================

    /// <summary>
    /// Generates short-lived presigned PUT URLs for direct browser-to-R2 upload.
    /// Supports single and batch upload requests.
    /// </summary>
    [HttpPost("upload-urls")]
    public async Task<ActionResult<UploadUrlBatchResponse>> CreatePresignedUploadUrls(
        string projectId,
        [FromBody] UploadUrlBatchRequest request,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(projectId))
            return Problem(statusCode: 400, title: "Project ID is required.");

        var identity = await AuthenticateAsync(cancellationToken);
        if (identity is null)
            return Unauthorized();

        if (request?.Files is null || request.Files.Count == 0)
        {
            return Problem(statusCode: 400, title: "No files specified in upload request.");
        }

        if (request.Files.Count > 25)
        {
            return Problem(statusCode: 400, title: "Cannot authorize more than 25 images per batch.");
        }

        var accountId = R2AccountId?.Trim();
        var bucket = R2BucketName?.Trim();
        var accessKey = R2AccessKeyId?.Trim();
        var secretKey = R2SecretAccessKey?.Trim();

        // Check if R2 is configured
        if (string.IsNullOrWhiteSpace(accountId) ||
            string.IsNullOrWhiteSpace(bucket) ||
            string.IsNullOrWhiteSpace(accessKey) ||
            string.IsNullOrWhiteSpace(secretKey))
        {
            return Problem(
                statusCode: 503,
                title: "Cloudflare R2 is not configured.",
                detail: "Cloudflare R2 credentials (AccountId, BucketName, AccessKeyId, SecretAccessKey) are not configured on this server.");
        }

        var cleanProjectId = CleanPathSegment(projectId);
        var responses = new List<UploadUrlResponse>(request.Files.Count);

        foreach (var file in request.Files)
        {
            var mimeType = file.FileType?.ToLowerInvariant().Trim() ?? string.Empty;
            if (!AllowedMimeTypes.Contains(mimeType))
            {
                return Problem(
                    statusCode: 400,
                    title: "Invalid file type.",
                    detail: $"FileType '{file.FileType}' is not allowed. Only JPEG, PNG, and WebP images are allowed.");
            }

            if (file.FileSize <= 0 || file.FileSize > MaxFileSizeBytes)
            {
                return Problem(
                    statusCode: 400,
                    title: "Invalid file size.",
                    detail: $"File size must be between 1 byte and 15 MB. Declared size: {file.FileSize} bytes.");
            }

            var attachmentId = !string.IsNullOrWhiteSpace(file.AttachmentId)
                ? CleanPathSegment(file.AttachmentId)
                : Guid.NewGuid().ToString("N");

            var seqNumber = file.SequenceNumber ?? 1;
            var ext = GetExtensionFromMimeType(mimeType);

            // Folder name: {ProjectName}_{StartDate} or cleanProjectId
            // File name: {N}.{ext}
            // Full object key: sentinelops/{businessId}/{folder}/{N}.{ext}
            var folder = !string.IsNullOrWhiteSpace(file.FolderName)
                ? CleanPathSegment(file.FolderName)
                : cleanProjectId;

            var objectKey = $"sentinelops/{identity.Value.BusinessId}/{folder}/{seqNumber}.{ext}";

            const long expiresInSeconds = 600; // 10 minutes
            var presignedUrl = GenerateR2PresignedUrl(
                accountId: accountId,
                bucket: bucket,
                objectKey: objectKey,
                httpMethod: "PUT",
                contentType: mimeType,
                accessKey: accessKey,
                secretKey: secretKey,
                expiresInSeconds: expiresInSeconds);

            responses.Add(new UploadUrlResponse(
                UploadUrl: presignedUrl,
                ObjectKey: objectKey,
                AttachmentId: attachmentId,
                SequenceNumber: seqNumber,
                FileType: mimeType,
                FileSize: file.FileSize,
                ExpiresInSeconds: expiresInSeconds,
                Bucket: bucket,
                FolderName: folder));
        }

        return Ok(new UploadUrlBatchResponse(responses));
    }

    /// <summary>
    /// Finalizes an uploaded R2 object: validates object scope and security bounds.
    /// </summary>
    [HttpPost("complete")]
    public async Task<ActionResult<FinalizeUploadResponse>> FinalizeUpload(
        string projectId,
        [FromBody] FinalizeUploadRequest request,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(projectId))
            return Problem(statusCode: 400, title: "Project ID is required.");

        var identity = await AuthenticateAsync(cancellationToken);
        if (identity is null)
            return Unauthorized();

        if (string.IsNullOrWhiteSpace(request.AttachmentId) ||
            string.IsNullOrWhiteSpace(request.ObjectKey))
        {
            return Problem(statusCode: 400, title: "Invalid upload completion payload.");
        }

        var cleanProjectId = CleanPathSegment(projectId);
        var expectedPrefix = $"sentinelops/{identity.Value.BusinessId}/";

        // Validate that object key belongs strictly to this business scope
        if (!request.ObjectKey.StartsWith(expectedPrefix, StringComparison.Ordinal))
        {
            return Problem(
                statusCode: 403,
                title: "Unauthorized object scope.",
                detail: "Object key does not match business scope.");
        }

        if (request.FileSize <= 0 || request.FileSize > MaxFileSizeBytes)
        {
            return Problem(
                statusCode: 400,
                title: "Invalid file size.",
                detail: "Finalized file size must be between 1 byte and 15 MB.");
        }

        var mimeType = request.FileType?.ToLowerInvariant().Trim() ?? string.Empty;
        if (!AllowedMimeTypes.Contains(mimeType))
        {
            return Problem(
                statusCode: 400,
                title: "Invalid file type.",
                detail: "Only JPEG, PNG, and WebP images are allowed.");
        }

        return Ok(new FinalizeUploadResponse(
            Status: "completed",
            AttachmentId: request.AttachmentId,
            ObjectKey: request.ObjectKey,
            ETag: request.ETag,
            FileSize: request.FileSize,
            CompletedAtUtc: DateTime.UtcNow));
    }

    /// <summary>
    /// Generates a short-lived presigned GET download URL for viewing private R2 images.
    /// </summary>
    [HttpGet("{attachmentId}/download-url")]
    public async Task<ActionResult<DownloadUrlResponse>> GetPresignedDownloadUrl(
        string projectId,
        string attachmentId,
        [FromQuery] string? fileName,
        [FromQuery] string? key,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(projectId) || string.IsNullOrWhiteSpace(attachmentId))
            return Problem(statusCode: 400, title: "Project ID and Attachment ID are required.");

        var identity = await AuthenticateAsync(cancellationToken);
        if (identity is null)
            return Unauthorized();

        var accountId = R2AccountId?.Trim();
        var bucket = R2BucketName?.Trim();
        var accessKey = R2AccessKeyId?.Trim();
        var secretKey = R2SecretAccessKey?.Trim();

        if (string.IsNullOrWhiteSpace(accountId) ||
            string.IsNullOrWhiteSpace(bucket) ||
            string.IsNullOrWhiteSpace(accessKey) ||
            string.IsNullOrWhiteSpace(secretKey))
        {
            return Problem(
                statusCode: 503,
                title: "Cloudflare R2 is not configured.",
                detail: "Cloudflare R2 credentials are not configured on this server.");
        }

        var expectedPrefix = $"sentinelops/{identity.Value.BusinessId}/";
        string objectKey;

        if (!string.IsNullOrWhiteSpace(key) && key.StartsWith(expectedPrefix, StringComparison.Ordinal))
        {
            objectKey = key;
        }
        else
        {
            var cleanProjectId = CleanPathSegment(projectId);
            var cleanAttachmentId = CleanPathSegment(attachmentId);
            objectKey = $"sentinelops/{identity.Value.BusinessId}/projects/{cleanProjectId}/{cleanAttachmentId}";
        }

        const long expiresInSeconds = 900; // 15 minutes
        var downloadUrl = GenerateR2PresignedUrl(
            accountId: accountId,
            bucket: bucket,
            objectKey: objectKey,
            httpMethod: "GET",
            contentType: null,
            accessKey: accessKey,
            secretKey: secretKey,
            expiresInSeconds: expiresInSeconds,
            responseContentDisposition: !string.IsNullOrWhiteSpace(fileName)
                ? $"attachment; filename=\"{CleanFilename(fileName)}\""
                : null);

        return Ok(new DownloadUrlResponse(
            DownloadUrl: downloadUrl,
            ObjectKey: objectKey,
            ExpiresInSeconds: expiresInSeconds,
            DerivedFileName: fileName));
    }

    // =========================================================================
    // BACKWARD COMPATIBILITY: CLOUDINARY SIGNATURE ENDPOINT
    // =========================================================================

    [HttpPost("upload-signature")]
    public async Task<ActionResult<UploadSignatureResponse>> CreateUploadSignature(
        string projectId,
        [FromBody] UploadSignatureRequest request,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(projectId))
            return Problem(statusCode: 400, title: "Project ID is required.");

        var identity = await AuthenticateAsync(cancellationToken);
        if (identity is null)
            return Unauthorized();

        var mimeType = request.FileType?.ToLowerInvariant().Trim() ?? string.Empty;
        if (!AllowedMimeTypes.Contains(mimeType))
        {
            return Problem(
                statusCode: 400,
                title: "Invalid file type.",
                detail: "Only JPEG, PNG, and WebP images are allowed.");
        }

        if (request.FileSize <= 0 || request.FileSize > MaxFileSizeBytes)
        {
            return Problem(
                statusCode: 400,
                title: "Invalid file size.",
                detail: "Image file size must be between 1 byte and 15 MB.");
        }

        var cloudName = CloudinaryCloudName?.Trim();
        var apiKey = CloudinaryApiKey?.Trim();
        var apiSecret = CloudinaryApiSecret?.Trim();

        if (string.IsNullOrWhiteSpace(cloudName) ||
            string.IsNullOrWhiteSpace(apiKey) ||
            string.IsNullOrWhiteSpace(apiSecret))
        {
            return Problem(
                statusCode: 503,
                title: "Cloudinary is not configured.",
                detail: "Cloudinary credentials (CloudName, ApiKey, ApiSecret) are not configured on this server.");
        }

        var cleanProjectId = CleanPathSegment(projectId);
        var attachmentId = !string.IsNullOrWhiteSpace(request.AttachmentId)
            ? CleanPathSegment(request.AttachmentId)
            : Guid.NewGuid().ToString("N");

        var folder = $"sentinelops/{identity.Value.BusinessId}/projects/{cleanProjectId}";
        var publicId = $"{folder}/{attachmentId}";
        var timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds();

        var toSign = $"folder={folder}&public_id={publicId}&timestamp={timestamp}{apiSecret}";
        var signature = Convert.ToHexString(SHA1.HashData(Encoding.UTF8.GetBytes(toSign))).ToLowerInvariant();
        var uploadUrl = $"https://api.cloudinary.com/v1_1/{cloudName}/image/upload";

        return Ok(new UploadSignatureResponse(
            CloudName: cloudName,
            ApiKey: apiKey,
            PublicId: publicId,
            Folder: folder,
            Timestamp: timestamp,
            Signature: signature,
            UploadUrl: uploadUrl,
            AttachmentId: attachmentId));
    }

    // =========================================================================
    // AWS SIGV4 PRESIGNED URL GENERATOR (Self-Contained S3 / R2 Protocol)
    // =========================================================================

    private static string GenerateR2PresignedUrl(
        string accountId,
        string bucket,
        string objectKey,
        string httpMethod,
        string? contentType,
        string accessKey,
        string secretKey,
        long expiresInSeconds,
        string? responseContentDisposition = null)
    {
        var now = DateTimeOffset.UtcNow;
        var dateStamp = now.ToString("yyyyMMdd");
        var isoTimestamp = now.ToString("yyyyMMddTHHmmssZ");
        const string region = "auto";
        const string service = "s3";

        var host = $"{accountId}.r2.cloudflarestorage.com";
        var canonicalUri = $"/{bucket}/{objectKey}";

        var credentialScope = $"{dateStamp}/{region}/{service}/aws4_request";
        var credentialParam = $"{accessKey}/{credentialScope}";

        // Canonical query parameters sorted in standard byte order
        var queryParams = new SortedDictionary<string, string>(StringComparer.Ordinal)
        {
            ["X-Amz-Algorithm"] = "AWS4-HMAC-SHA256",
            ["X-Amz-Credential"] = credentialParam,
            ["X-Amz-Date"] = isoTimestamp,
            ["X-Amz-Expires"] = expiresInSeconds.ToString(),
            ["X-Amz-SignedHeaders"] = !string.IsNullOrWhiteSpace(contentType) ? "content-type;host" : "host"
        };

        if (!string.IsNullOrWhiteSpace(responseContentDisposition))
        {
            queryParams["response-content-disposition"] = responseContentDisposition;
        }

        var canonicalQueryBuilder = new StringBuilder();
        foreach (var kvp in queryParams)
        {
            if (canonicalQueryBuilder.Length > 0) canonicalQueryBuilder.Append('&');
            canonicalQueryBuilder.Append(Uri.EscapeDataString(kvp.Key))
                .Append('=')
                .Append(Uri.EscapeDataString(kvp.Value));
        }
        var canonicalQueryString = canonicalQueryBuilder.ToString();

        // Canonical Headers
        var canonicalHeadersBuilder = new StringBuilder();
        if (!string.IsNullOrWhiteSpace(contentType))
        {
            canonicalHeadersBuilder.Append("content-type:").Append(contentType.Trim().ToLowerInvariant()).Append('\n');
        }
        canonicalHeadersBuilder.Append("host:").Append(host.ToLowerInvariant()).Append('\n');
        var canonicalHeaders = canonicalHeadersBuilder.ToString();

        var signedHeaders = !string.IsNullOrWhiteSpace(contentType) ? "content-type;host" : "host";

        // Canonical Request
        var canonicalRequest = $"{httpMethod}\n{canonicalUri}\n{canonicalQueryString}\n{canonicalHeaders}\n{signedHeaders}\nUNSIGNED-PAYLOAD";
        var canonicalRequestHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(canonicalRequest))).ToLowerInvariant();

        // String to Sign
        var stringToSign = $"AWS4-HMAC-SHA256\n{isoTimestamp}\n{credentialScope}\n{canonicalRequestHash}";

        // Derived Signing Key
        var kSecret = Encoding.UTF8.GetBytes("AWS4" + secretKey);
        var kDate = HMACSHA256.HashData(kSecret, Encoding.UTF8.GetBytes(dateStamp));
        var kRegion = HMACSHA256.HashData(kDate, Encoding.UTF8.GetBytes(region));
        var kService = HMACSHA256.HashData(kRegion, Encoding.UTF8.GetBytes(service));
        var kSigning = HMACSHA256.HashData(kService, Encoding.UTF8.GetBytes("aws4_request"));

        var signatureBytes = HMACSHA256.HashData(kSigning, Encoding.UTF8.GetBytes(stringToSign));
        var signature = Convert.ToHexString(signatureBytes).ToLowerInvariant();

        return $"https://{host}{canonicalUri}?{canonicalQueryString}&X-Amz-Signature={signature}";
    }

    private async Task<(Guid BusinessId, Guid DeviceId)?> AuthenticateAsync(CancellationToken cancellationToken)
    {
        var presented = Request.Headers.Authorization.ToString();
        if (!presented.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)) return null;
        var token = presented["Bearer ".Length..].Trim();
        if (token.Length < 32) return null;

        var headerDeviceId = Request.Headers["X-Device-Id"].ToString();
        var tokenHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

        RegisteredDevice? device = null;
        if (Guid.TryParse(headerDeviceId, out var deviceId) && deviceId != Guid.Empty)
        {
            device = await db.RegisteredDevices.AsNoTracking().SingleOrDefaultAsync(
                x => x.Id == deviceId && x.RevokedAtUtc == null, cancellationToken);
        }
        else
        {
            device = await db.RegisteredDevices.AsNoTracking().FirstOrDefaultAsync(
                x => x.TokenHash == tokenHash && x.RevokedAtUtc == null, cancellationToken);
        }

        if (device is null || !CryptographicOperations.FixedTimeEquals(
            Convert.FromHexString(device.TokenHash), SHA256.HashData(Encoding.UTF8.GetBytes(token))))
        {
            return null;
        }

        return (device.BusinessId, device.Id);
    }

    private static string CleanPathSegment(string input)
    {
        var sb = new StringBuilder();
        foreach (var ch in input)
        {
            if (char.IsLetterOrDigit(ch) || ch == '-' || ch == '_')
            {
                sb.Append(ch);
            }
        }
        var cleaned = sb.ToString().Trim('-', '_');
        return string.IsNullOrEmpty(cleaned) ? Guid.NewGuid().ToString("N") : cleaned;
    }

    private static string CleanFilename(string input)
    {
        var sb = new StringBuilder();
        foreach (var ch in input)
        {
            if (char.IsLetterOrDigit(ch) || ch == '-' || ch == '_' || ch == '.')
            {
                sb.Append(ch);
            }
        }
        var cleaned = sb.ToString();
        return string.IsNullOrEmpty(cleaned) ? "download.jpg" : cleaned;
    }

    private static string GetExtensionFromMimeType(string mimeType)
    {
        return mimeType switch
        {
            "image/png" => "png",
            "image/webp" => "webp",
            _ => "jpg"
        };
    }
}
