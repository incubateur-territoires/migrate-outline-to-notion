import { Client } from '@notionhq/client';
import { AppendBlockChildrenResponse, PageObjectResponse } from '@notionhq/client/build/src/api-endpoints';
import { RateLimiter } from './utils/rateLimiter';

export interface PageMapping {
  outlinePath: string;
  notionId: string;
  title: string;
  url: string;
}

export class NotionClient {
  private client: Client;
  private rateLimiter: RateLimiter;

  constructor(apiKey: string) {
    this.client = new Client({ auth: apiKey });
    this.rateLimiter = new RateLimiter();
  }

  async createFolderPage(folderName: string, parentPageId: string, children: any[] = []): Promise<PageObjectResponse> {
    return await this.rateLimiter.add(parentPageId, () => {
      const notionPage = {
        parent: { page_id: parentPageId },
        properties: {
          title: {
            title: [{ text: { content: folderName } }]
          }
        },
        children
      };
      return this.client.pages.create(notionPage) as Promise<PageObjectResponse>;
    });
  }

  async createEmptyPage(title: string, parentPageId: string): Promise<PageObjectResponse> {
    return await this.rateLimiter.add(parentPageId, () => {
      const notionPage = {
        parent: { page_id: parentPageId },
        properties: {
          title: {
            title: [{ text: { content: title } }]
          }
        }
      };
      return this.client.pages.create(notionPage) as Promise<PageObjectResponse>;
    });
  }

  async appendBlocks(pageId: string, blocks: any[]): Promise<AppendBlockChildrenResponse> {
    return await this.rateLimiter.add(pageId, () => 
      this.client.blocks.children.append({
        block_id: pageId,
        children: blocks
      })
    );
  }
} 