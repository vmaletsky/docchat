import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const region = requireEnv("AWS_REGION");
const accessKeyId = requireEnv("AWS_ACCESS_KEY_ID");
const secretAccessKey = requireEnv("AWS_SECRET_ACCESS_KEY");
const bucket = requireEnv("S3_BUCKET");

const client = new S3Client({
  region,
  credentials: { accessKeyId, secretAccessKey },
});

export async function uploadToS3(buffer: Buffer, key: string): Promise<void> {
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: "application/pdf",
    })
  );
}

export async function deleteFromS3(key: string): Promise<void> {
  await client.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  );
}
