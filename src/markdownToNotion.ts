import { readFile } from 'fs/promises';
import path from 'path';
import { Client } from '@notionhq/client';
import { markdownToBlocks } from '@tryfabric/martian';

interface PageMapping {
  outlinePath: string;
  notionId: string;
  title: string;
  url: string;
}

export class MarkdownToNotionConverter {
  private notion: Client;
  private pageMap: Map<string, PageMapping>;

  constructor(notionClient: Client, pageMap: Map<string, PageMapping>) {
    this.notion = notionClient;
    this.pageMap = pageMap;
  }

  private async uploadImageToNotion(imagePath: string): Promise<string | null> {
    console.log(`Need to upload image to S3 and then link it in Notion: ${imagePath}`);
    return null;
  }

  private async findImageInUploads(mdFilePath: string, imageName: string): Promise<string | null> {
    const mdDir = path.dirname(mdFilePath);
    const possiblePaths = [
      path.join(mdDir, 'uploads', imageName),
      path.join(mdDir, '..', 'uploads', imageName),
    ];

    for (const imgPath of possiblePaths) {
      try {
        await readFile(imgPath);
        return imgPath;
      } catch {
        continue;
      }
    }
    return null;
  }

  private normalizeTableRowBlocks(tableRowBlocks: any[]): any[] {
    if (!tableRowBlocks?.length) return [];
    
    const maxColumns = Math.max(...tableRowBlocks.map(block => block.table_row?.cells?.length || 0));
    
    if (maxColumns === 0) return [];
    
    return tableRowBlocks.map(block => ({
      ...block,
      table_row: {
        cells: [
          ...(block.table_row?.cells || []),
          ...Array(maxColumns - (block.table_row?.cells?.length || 0)).fill([{
            type: 'text',
            text: { content: '' }
          }])
        ]
      }
    }));
  }

  private cleanMarkdownContent(content: string): string {
    return content
      .split('\n')
      .filter(line => !/^\s*\\+\s*$/.test(line))
      .join('\n');
  }

  private normalizeOutlinePath(url: string, currentFile: string): string {
    if (url.includes('outline.incubateur.anct.gouv.fr')) {
      const urlPath = new URL(url).pathname;
      return path.normalize(urlPath);
    }
    
    if (url.startsWith('./')) {
      return path.normalize(path.join(path.dirname(currentFile), url));
    }
    
    if (url.startsWith('/')) {
      return path.normalize(url);
    }
    
    return url;
  }

  private findMappedPage(normalizedPath: string): PageMapping | undefined {
    for (const [outlinePath, mapping] of this.pageMap.entries()) {
      if (normalizedPath.includes(encodeURIComponent(path.basename(outlinePath)))) {
        return mapping;
      }
    }
    return undefined;
  }

  public async convertMarkdownToNotionBlocks(content: string, mdFilePath: string) {
    const cleanedContent = this.cleanMarkdownContent(content);
      
    const processedContent = cleanedContent.replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      (match, text, url) => {
        if (url.startsWith('./') || url.startsWith('/') || url.includes('outline.incubateur.anct.gouv.fr')) {
          const normalizedPath = this.normalizeOutlinePath(url, mdFilePath);
          const mappedPage = this.findMappedPage(normalizedPath);

          if (mappedPage) {
            return `[${text}](${mappedPage.url})`;
          }
        }
        return text;
      }
    );

    try {
      const blocks = markdownToBlocks(processedContent);

      const processedBlocks = await Promise.all(blocks.map(async (block: any) => {
        if (block.type === 'image') {
          const imagePath = block.image?.external?.url || block.image?.file?.url;
          if (imagePath) {
            const cleanImagePath = imagePath.replace(/^(file:\/\/|https?:\/\/)/, '');
            const fullImagePath = await this.findImageInUploads(mdFilePath, cleanImagePath);
            
            if (fullImagePath) {
              const notionUrl = await this.uploadImageToNotion(fullImagePath);
              if (notionUrl) {
                return {
                  type: 'image',
                  image: {
                    type: 'external',
                    external: {
                      url: notionUrl
                    }
                  }
                };
              }
            }
          }
        }
        
        if (block.type === 'table') {
          const normalizedRows = this.normalizeTableRowBlocks(block.table?.children);
          
          if (!normalizedRows) {
            return {
              type: 'paragraph',
              paragraph: {
                rich_text: [{
                  type: 'text',
                  text: { content: 'Table conversion failed - invalid format' }
                }]
              }
            };
          }

          return {
            ...block,
            table: {
              ...block.table,
              children: normalizedRows
            }
          };
        }
        
        return block;
      }));

      return processedBlocks;
      
    } catch (error: any) {
      console.error('Error converting markdown to blocks:', error);
      return [{
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{
            type: 'text',
            text: { content: 'Error converting content: ' + error.message }
          }]
        }
      }];
    }
  }
} 