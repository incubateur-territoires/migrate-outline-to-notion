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

  const chunks = [];
  for (let i = 0; i < blocks.length; i += 100) {
    chunks.push(blocks.slice(i, i + 100));
  }

  for (const chunk of chunks) {
    try {
      await notionClient.appendBlocks(notionId, chunk);
      console.log(`> Appended blocks chunk for ${fullPath}`);
    } catch (error) {
      console.error(`Error appending blocks for ${fullPath}:`, error);
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
    console.log(`Created empty page for ${fullPath}`);
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

    console.log(`Created Notion folder page for ${folderName}`);
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