import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export function createS3Service(env = process.env) {
  const region = env.AWS_REGION || "us-east-1";
  const bucket = env.S3_BUCKET_NAME || "";
  const hasCreds = !!(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY);
  const endpoint = env.S3_ENDPOINT || undefined;

  const isConfigured = () => {
    return !!(
      bucket &&
      (hasCreds ||
        env.AWS_PROFILE ||
        env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI)
    );
  };

  let client = null;
  if (isConfigured()) {
    client = new S3Client({
      region,
      endpoint,
      forcePathStyle: !!endpoint,
      credentials: hasCreds
        ? {
            accessKeyId: env.AWS_ACCESS_KEY_ID,
            secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
          }
        : undefined,
    });
  }

  const uploadFile = async ({
    key,
    buffer,
    contentType = "application/octet-stream",
    metadata = {},
  }) => {
    if (!client || !isConfigured()) {
      return {
        s3: false,
        key,
        size: buffer.length,
        message: "Amazon S3 is not configured. File kept in local buffer.",
      };
    }

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      Metadata: metadata,
    });

    const res = await client.send(command);
    return {
      s3: true,
      bucket,
      key,
      size: buffer.length,
      etag: res.ETag,
      url: `https://${bucket}.s3.${region}.amazonaws.com/${key}`,
    };
  };

  const getFile = async ({ key }) => {
    if (!client || !isConfigured()) {
      throw new Error("Amazon S3 is not configured.");
    }

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const res = await client.send(command);
    const byteArray = await res.Body.transformToByteArray();
    return {
      buffer: Buffer.from(byteArray),
      contentType: res.ContentType || "application/octet-stream",
      metadata: res.Metadata || {},
      size: byteArray.length,
    };
  };

  const deleteFile = async ({ key }) => {
    if (!client || !isConfigured()) {
      return { success: false, message: "Amazon S3 is not configured." };
    }

    const command = new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    await client.send(command);
    return { success: true, key };
  };

  const getPresignedDownloadUrl = async ({ key, expiresIn = 3600 }) => {
    if (!client || !isConfigured()) {
      return null;
    }

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    return await getSignedUrl(client, command, { expiresIn });
  };

  const getPresignedUploadUrl = async ({
    key,
    contentType = "application/octet-stream",
    expiresIn = 900,
  }) => {
    if (!client || !isConfigured()) {
      return null;
    }

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
    });

    return await getSignedUrl(client, command, { expiresIn });
  };

  return {
    client,
    bucket,
    region,
    isConfigured,
    uploadFile,
    getFile,
    deleteFile,
    getPresignedDownloadUrl,
    getPresignedUploadUrl,
  };
}
