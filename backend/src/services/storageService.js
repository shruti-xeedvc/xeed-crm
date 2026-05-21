const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

let s3 = null;

const getClient = () => {
  if (!s3) {
    const accountId = process.env.R2_ACCOUNT_ID;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    if (!accountId || !accessKeyId || !secretAccessKey) {
      throw new Error('R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY must be set');
    }
    s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
  }
  return s3;
};

const BUCKET = process.env.R2_BUCKET_NAME || 'pitchdecks';

/**
 * Upload a PDF buffer to Cloudflare R2.
 * Returns the public URL (requires the bucket to have public access enabled).
 */
const uploadPdf = async (filename, buffer) => {
  const client = getClient();

  await client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: filename,
    Body: buffer,
    ContentType: 'application/pdf',
  }));

  // Public URL — set R2_PUBLIC_URL to your bucket's public domain
  // e.g. https://pub-xxxx.r2.dev  or  https://decks.yourdomain.com
  const publicBase = process.env.R2_PUBLIC_URL?.replace(/\/$/, '');
  if (!publicBase) throw new Error('R2_PUBLIC_URL must be set to the bucket\'s public domain');

  return `${publicBase}/${filename}`;
};

module.exports = { uploadPdf };
