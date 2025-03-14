import { access } from 'fs/promises';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createReadStream } from 'fs';
import { lookup } from 'mime-types';
import logger from './utils/logger';
import https from 'https';

export class S3Uploader {
  private s3Client: S3Client | undefined;
  private bucket: string;
  private region: string;
  private useOriginalBucket: boolean;
  private originalBucketEndPoint: string | undefined;

  constructor() {
    this.region = process.env.AWS_REGION || '';
    this.bucket = process.env.AWS_S3_BUCKET || '';
    this.useOriginalBucket = process.env.USE_ORIGINAL_BUCKET === 'true';
    this.originalBucketEndPoint = process.env.ORIGINAL_BUCKET_END_POINT?.replace(/\/$/, ''); // Remove trailing slash if present
    
    // Only initialize S3 client if we're not using original bucket
    if (!this.useOriginalBucket) {
      if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
        throw new Error('AWS credentials are required when USE_ORIGINAL_BUCKET is false');
      }
      
      this.s3Client = new S3Client({
        region: this.region,
        endpoint: process.env.AWS_ENDPOINT,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        },
      });
    }
  }

  private encodeUrl(url: string): string {
    // Split the URL into parts (before the path and the path itself)
    const [baseUrl, ...pathParts] = url.split('/public/');
    if (pathParts.length === 0) return url;

    // Encode each path segment individually, preserving the /public/ part
    const path = pathParts.join('/public/');
    const encodedPath = path.split('/')
      .map(segment => encodeURIComponent(segment))
      .join('/');

    return `${baseUrl}/public/${encodedPath}`;
  }

  private async checkUrlExists(url: string): Promise<boolean> {
    const encodedUrl = this.encodeUrl(url);
    return new Promise((resolve) => {
      const request = https.request(encodedUrl, { method: 'HEAD' }, (res) => {
        resolve(res.statusCode === 200);
      });

      request.on('error', (error) => {
        logger.warn(`Could not verify file existence at URL ${encodedUrl}: ${error.message}`);
        resolve(false);
      });

      request.end();
    });
  }

  // Ajouter cette méthode
  public getClient(): S3Client | undefined {
    return this.s3Client;
  }

  async uploadFile(filePath: string, originalPath?: string): Promise<string> {
    if (this.useOriginalBucket && originalPath) {
      if (!this.originalBucketEndPoint) {
        throw new Error('ORIGINAL_BUCKET_END_POINT environment variable is required when USE_ORIGINAL_BUCKET is true');
      }

      const fileUrl = `${this.originalBucketEndPoint}/${originalPath}`;
      const encodedUrl = this.encodeUrl(fileUrl);
      const exists = await this.checkUrlExists(fileUrl);
      
      if (!exists) {
        logger.warn(`File not found at URL: ${fileUrl}`);
      }

      return encodedUrl;
    }

    if (!this.s3Client) {
      throw new Error('S3 client not initialized');
    }

    await access(filePath);
      
    const fileName = `uploads/${Date.now()}-${filePath.split('/').pop()}`;
    const mimeType = lookup(filePath) || 'application/octet-stream';

    try {
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: fileName,
          Body: createReadStream(filePath),
          ContentType: mimeType,
        })
      );

      const url = `https://${this.bucket}.s3.${this.region}.scw.cloud/${fileName}`;
      return this.encodeUrl(url);
    } catch (error) {
      logger.error('Error uploading to S3:', error);
      throw new Error(`Failed to upload image to S3: ${error}`);
    }
  }
} 