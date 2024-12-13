import { access } from 'fs/promises';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createReadStream } from 'fs';
import { lookup } from 'mime-types';

export class S3Uploader {
  private s3Client: S3Client;
  private bucket: string;
  private region: string;

  constructor() {
    this.region = process.env.AWS_REGION || '';
    this.bucket = process.env.AWS_S3_BUCKET || '';
    
    this.s3Client = new S3Client({
      region: this.region,
      endpoint: process.env.AWS_ENDPOINT,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      },
    });
  }

  // Ajouter cette méthode
  public getClient(): S3Client {
    return this.s3Client;
  }

  async uploadFile(filePath: string): Promise<string> {

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

      return encodeURI(`https://${this.bucket}.s3.${this.region}.scw.cloud/${fileName}`);
    } catch (error) {
      console.error('Error uploading to S3:', error);
      throw new Error(`Failed to upload image to S3: ${error}`);
    }
  }
} 