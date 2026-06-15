import { S3Client, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from './env.js';

let client: S3Client | null = null;

function getClient(): S3Client {
  if (!client) {
    client = new S3Client({
      region: env.awsRegion,
      credentials:
        env.awsAccessKeyId && env.awsSecretAccessKey
          ? {
              accessKeyId: env.awsAccessKeyId,
              secretAccessKey: env.awsSecretAccessKey,
            }
          : undefined,
    });
  }
  return client;
}

export function buildObjectKey(partyId: string, type: string, documentId: string): string {
  return `${partyId}/${type}/${documentId}`;
}

export async function getUploadUrl(key: string, mimeType: string): Promise<string> {
  if (env.awsS3Mock) {
    return `mock-s3://${env.awsS3Bucket}/${key}?contentType=${encodeURIComponent(mimeType)}`;
  }
  const command = new PutObjectCommand({
    Bucket: env.awsS3Bucket,
    Key: key,
    ContentType: mimeType,
  });
  return getSignedUrl(getClient(), command, { expiresIn: 900 });
}

export async function headObject(key: string): Promise<boolean> {
  if (env.awsS3Mock) return true;
  try {
    await getClient().send(new HeadObjectCommand({ Bucket: env.awsS3Bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

export function fileUriForKey(key: string): string {
  return `s3://${env.awsS3Bucket}/${key}`;
}
