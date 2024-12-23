import { Client } from '@notionhq/client';
import { AppendBlockChildrenResponse, PageObjectResponse } from '@notionhq/client/build/src/api-endpoints';
import { RateLimiter } from './utils/rateLimiter';
import logger from './utils/logger';

export interface PageMapping {
  outlinePath: string;
  notionId: string;
  title: string;
  url: string;
}

export class NotionClient {
  private client: Client;
  private rateLimiter: RateLimiter;

  constructor(apiKey: string, rateLimiter: RateLimiter) {
    this.client = new Client({ auth: apiKey });
    this.rateLimiter = rateLimiter;
    logger.debug('NotionClient initialized');
  }

  async createFolderPage(
    folderName: string, 
    parentPageId: string, 
    fullPath: string,
    children: any[] = []
  ): Promise<PageObjectResponse> {
    try {
      logger.debug('Creating folder page', {
        folderName,
        parentPageId,
        fullPath,
        childrenCount: children.length
      });

      const result = await this.rateLimiter.add(parentPageId, () => {
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

      logger.debug('Folder page created successfully', {
        folderName,
        newPageId: result.id,
        fullPath
      });

      return result;
    } catch (error) {
      logger.error('Error creating folder page', {
        folderName,
        parentPageId,
        fullPath,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  async createEmptyPage(
    title: string, 
    parentPageId: string, 
    fullPath: string
  ): Promise<PageObjectResponse> {
    try {
      logger.debug('Creating empty page', {
        title,
        parentPageId,
        fullPath
      });

      const result = await this.rateLimiter.add(parentPageId, () => {
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

      logger.debug('Empty page created successfully', {
        title,
        newPageId: result.id,
        fullPath
      });

      return result;
    } catch (error) {
      logger.error('Error creating empty page', {
        title,
        parentPageId,
        fullPath,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  async appendBlocks(
    pageId: string, 
    blocks: any[], 
    fullPath: string
  ): Promise<AppendBlockChildrenResponse> {
    try {
      logger.debug('Appending blocks to page', {
        pageId,
        blocksCount: blocks.length,
        fullPath
      });

      const result = await this.rateLimiter.add(pageId, () => 
        this.client.blocks.children.append({
          block_id: pageId,
          children: blocks
        })
      );

      logger.debug('Blocks appended successfully', {
        pageId,
        addedBlocksCount: result.results.length,
        fullPath
      });

      return result;
    } catch (error) {
      logger.error('Error appending blocks', {
        pageId,
        blocksCount: blocks.length,
        fullPath,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }
} 