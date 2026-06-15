import 'dotenv/config';

export const env = {
  port: Number(process.env.PORT ?? 3001),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  sessionSecret: process.env.SESSION_SECRET ?? 'dev-secret-change-me-min-32-characters',
  nodeEnv: process.env.NODE_ENV ?? 'development',
  awsRegion: process.env.AWS_REGION ?? 'us-east-1',
  awsS3Bucket: process.env.AWS_S3_BUCKET ?? 'indexcore-documents-dev',
  awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID,
  awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  awsS3Mock: process.env.AWS_S3_MOCK === 'true',
  sessionMaxAgeHours: 8,
};
