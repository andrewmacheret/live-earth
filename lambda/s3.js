// The bucket and file come from the BUCKET and KEY settings on each Lambda.
async function s3() {
  const sdk = await import('@aws-sdk/client-s3');
  return { sdk, client: new sdk.S3Client({}) };
}

export async function loadFromS3() {
  const { sdk, client } = await s3();
  const result = await client.send(new sdk.GetObjectCommand({ Bucket: process.env.BUCKET, Key: process.env.KEY }));
  return JSON.parse(await result.Body.transformToString());
}

export async function saveToS3(body, cacheControl, key = process.env.KEY) {
  const { sdk, client } = await s3();
  await client.send(
    new sdk.PutObjectCommand({
      Bucket: process.env.BUCKET,
      Key: key,
      Body: body,
      ContentType: 'application/json',
      CacheControl: cacheControl
    })
  );
}
