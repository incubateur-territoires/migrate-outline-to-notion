import * as path from 'path';
import { NotionClient } from './notionClient';
import { MarkdownToNotionConverter } from './markdownToNotion';
import { PageMapping } from './notionClient';
import logger from './utils/logger';

export const processNotionContent = async (
  content: string,
  fullPath: string,
  notionId: string,
  notionClient: NotionClient,
  converter: MarkdownToNotionConverter
): Promise<void> => {
  try {
    logger.debug('Converting markdown to Notion blocks', { fullPath });
    const blocks = await converter.convertMarkdownToNotionBlocks(content, fullPath);
    await appendBlocksInOrder(blocks, notionId, notionClient, fullPath);
  } catch (error) {
    logger.error('Error processing Notion content', {
      fullPath,
      notionId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    throw error;
  }
};

const getMaxNestingLevel = (blocks: any[]): number => {
  let maxLevel = 0;
  
  const checkBlockDepth = (block: any, currentLevel: number): void => {
    const blockType = block.type;
    const children = block[blockType]?.children;
    
    if (children?.length > 0) {
      maxLevel = Math.max(maxLevel, currentLevel + 1);
      children.forEach((child: any) => checkBlockDepth(child, currentLevel + 1));
    }
  };

  blocks.forEach(block => checkBlockDepth(block, 0));
  return maxLevel;
};

const appendBlocksInOrder = async (
  blocks: any[],
  parentId: string,
  notionClient: NotionClient,
  fullPath: string,
  level: number = 0
): Promise<void> => {
  const shouldSplitChildren = level === 0 ? getMaxNestingLevel(blocks) > 2 : true;
  let currentBatch: any[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const blockType = block.type;
    const hasChildren = block[blockType]?.children?.length > 0;
    
    if (blockType !== 'table' && hasChildren && shouldSplitChildren) {
      if (currentBatch.length > 0) {
        try {
          await notionClient.appendBlocks(parentId, currentBatch, fullPath);
          currentBatch = [];
        } catch (error) {
          logger.error('Error appending batch', {
            fullPath,
            level,
            batchSize: currentBatch.length,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

      try {
        const children = block[blockType].children;
        const blockWithoutChildren = {
          ...block,
          [blockType]: { ...block[blockType], children: undefined }
        };
        
        const response = await notionClient.appendBlocks(parentId, [blockWithoutChildren], fullPath);
        const blockId = response.results[0].id;

        await appendBlocksInOrder(
          children,
          blockId,
          notionClient,
          fullPath,
          level + 1
        );
      } catch (error) {
        logger.error('Error appending block with children', {
          fullPath,
          level,
          blockType,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    } else {
      currentBatch.push(block);
      
      if (currentBatch.length === 100 || i === blocks.length - 1) {
        try {
          await notionClient.appendBlocks(parentId, currentBatch, fullPath);
          logger.debug('Appended blocks batch', {
            fullPath,
            level,
            batchSize: currentBatch.length
          });
          currentBatch = [];
        } catch (error) {
          logger.error('Error appending batch', {
            fullPath,
            level,
            batchSize: currentBatch.length,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }
    }
  }
};

export const createNotionPage = async (
  fullPath: string,
  title: string,
  currentFolderPageId: string,
  notionClient: NotionClient,
  pageMap: Map<string, PageMapping>
): Promise<void> => {
  try {
    logger.debug('Creating empty page', {
      fullPath,
      title,
      currentFolderPageId
    });

    const response = await notionClient.createEmptyPage(title, currentFolderPageId, fullPath);
    pageMap.set(fullPath, {
      outlinePath: fullPath,
      notionId: response.id,
      title,
      url: response.url
    });
    
    logger.debug('Created empty page successfully', {
      fullPath,
      notionId: response.id
    });
  } catch (error) {
    logger.debug('Error creating empty page', {
      fullPath,
      title,
      currentFolderPageId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    throw error;
  }
};

export const createNotionFolder = async (
  directoryPath: string,
  parentPageId: string,
  notionClient: NotionClient,
  pageMap: Map<string, PageMapping>,
  children: any[] = []
): Promise<string> => {
  const folderName = path.basename(directoryPath);
  const fullPath = directoryPath + '.md';

  try {
    logger.debug('Creating Notion folder page', {
      fullPath,
      folderName,
      parentPageId
    });

    const response = await notionClient.createFolderPage(folderName, parentPageId, fullPath, children);

    logger.debug('Created Notion folder page successfully', {
      fullPath,
      notionId: response.id
    });

    pageMap.set(fullPath, {
      outlinePath: directoryPath,
      notionId: response.id,
      title: folderName,
      url: response.url
    });
    return response.id;
  } catch (error) {
    logger.error('Error creating folder page', {
      fullPath,
      folderName,
      parentPageId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    return parentPageId;
  }
}; 