import * as path from 'path';
import { NotionClient } from './notionClient';
import { MarkdownToNotionConverter } from './markdownToNotion';
import { PageMapping } from './notionClient';

export const processNotionContent = async (
  content: string,
  fullPath: string,
  notionId: string,
  notionClient: NotionClient,
  converter: MarkdownToNotionConverter
): Promise<void> => {
  const blocks = await converter.convertMarkdownToNotionBlocks(content, fullPath);
  await appendBlocksInOrder(blocks, notionId, notionClient, fullPath);
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
      // First, append any accumulated simple blocks
      if (currentBatch.length > 0) {
        try {
          await notionClient.appendBlocks(parentId, currentBatch);
          currentBatch = [];
        } catch (error) {
          console.error(`Error appending batch at level ${level} for ${fullPath}:`, error);
        }
      }

      try {
        // Extract children and create a copy of the block without children
        const children = block[blockType].children;
        const blockWithoutChildren = {
          ...block,
          [blockType]: { ...block[blockType], children: undefined }
        };
        
        const response = await notionClient.appendBlocks(parentId, [blockWithoutChildren]);
        const blockId = response.results[0].id;

        await appendBlocksInOrder(
          children,
          blockId,
          notionClient,
          fullPath,
          level + 1
        );
      } catch (error) {
        console.error(`Error appending block with children at level ${level} for ${fullPath}:`, error);
      }
    } else {
      // Traiter comme un bloc simple avec ses enfants
      currentBatch.push(block);
      
      if (currentBatch.length === 100 || i === blocks.length - 1) {
        try {
          await notionClient.appendBlocks(parentId, currentBatch);
          console.log(`> Appended ${currentBatch.length} blocks at level ${level} for ${fullPath}`);
          currentBatch = [];
        } catch (error) {
          console.error(`Error appending batch at level ${level} for ${fullPath}:`, error);
          //console.log(`>> Batch content:`, JSON.stringify(currentBatch, null, 2));
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
    const response = await notionClient.createEmptyPage(title, currentFolderPageId);
    pageMap.set(fullPath, {
      outlinePath: fullPath,
      notionId: response.id,
      title,
      url: response.url
    });
    console.log(`> Created empty page for ${fullPath}`);
  } catch (error) {
    console.error(`Error creating empty page for ${fullPath}:`, error);
    throw error; // Re-throw to allow caller to handle the error
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

  try {
    const response = await notionClient.createFolderPage(folderName, parentPageId, children);

    console.log(`> Created Notion folder page for ${folderName}`);
    pageMap.set(directoryPath + '.md', {
      outlinePath: directoryPath,
      notionId: response.id,
      title: folderName,
      url: response.url
    });
    return response.id;
  } catch (error) {
    console.error(`Error creating folder page for ${folderName}:`, error);
    return parentPageId;
  }
}; 