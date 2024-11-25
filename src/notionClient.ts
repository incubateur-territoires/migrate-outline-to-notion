import { Client } from '@notionhq/client';
import { PageObjectResponse } from '@notionhq/client/build/src/api-endpoints';

export interface PageMapping {
  outlinePath: string;
  notionId: string;
  title: string;
  url: string;
}

export class NotionClient {
  private client: Client;

  constructor(apiKey: string) {
    this.client = new Client({ auth: apiKey });
  }

  async createFolderPage(folderName: string, parentPageId: string, children: any[] = []): Promise<PageObjectResponse> {
    const notionPage = {
      parent: {
        page_id: parentPageId
      },
      properties: {
        title: {
          title: [
            {
              text: {
                content: folderName
              }
            }
          ]
        }
      },
      children
    };

    return await this.client.pages.create(notionPage) as PageObjectResponse;
  }

  async createEmptyPage(title: string, parentPageId: string): Promise<PageObjectResponse> {
    const notionPage = {
      parent: { page_id: parentPageId },
      properties: {
        title: {
          title: [{ text: { content: title } }]
        }
      }
    };

    return await this.client.pages.create(notionPage) as PageObjectResponse;
  }

  async appendBlocks(pageId: string, blocks: any[]): Promise<void> {
    await this.client.blocks.children.append({
      block_id: pageId,
      children: blocks
    });
  }
} 