namespace SentinelOps.Api.Contracts;

// --- Cloudflare R2 Contracts (Section 6 & 7) ---

public sealed record UploadUrlRequest(
    string FileName,
    string FileType,
    long FileSize,
    string? AttachmentId = null,
    int? SequenceNumber = null,
    string? FolderName = null);

public sealed record UploadUrlBatchRequest(
    List<UploadUrlRequest> Files);

public sealed record UploadUrlResponse(
    string UploadUrl,
    string ObjectKey,
    string AttachmentId,
    int SequenceNumber,
    string FileType,
    long FileSize,
    long ExpiresInSeconds,
    string? Bucket = null,
    string? FolderName = null);

public sealed record UploadUrlBatchResponse(
    List<UploadUrlResponse> PresignedUrls);

public sealed record FinalizeUploadRequest(
    string AttachmentId,
    string ObjectKey,
    string FileType,
    long FileSize,
    int SequenceNumber,
    string? DerivedFileName = null,
    string? ETag = null);

public sealed record FinalizeUploadResponse(
    string Status,
    string AttachmentId,
    string ObjectKey,
    string? ETag,
    long FileSize,
    DateTime CompletedAtUtc);

public sealed record DownloadUrlResponse(
    string DownloadUrl,
    string ObjectKey,
    long ExpiresInSeconds,
    string? DerivedFileName = null);

// --- Cloudinary Backward Compatibility Contracts ---

public sealed record UploadSignatureRequest(
    string FileName,
    string FileType,
    long FileSize,
    string? AttachmentId = null,
    int? SequenceNumber = null);

public sealed record UploadSignatureResponse(
    string CloudName,
    string ApiKey,
    string PublicId,
    string Folder,
    long Timestamp,
    string Signature,
    string UploadUrl,
    string AttachmentId);

public sealed record UploadCompleteRequest(
    string AttachmentId,
    string PublicId,
    string SecureUrl,
    long FileSize,
    string FileType,
    int SequenceNumber,
    string? DerivedFileName = null);

public sealed record UploadCompleteResponse(
    string Status,
    string AttachmentId,
    DateTime CompletedAtUtc);
