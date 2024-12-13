import path from 'path';
import { markdownToBlocks } from '@tryfabric/martian';
import { S3Uploader } from './s3Client';

interface PageMapping {
  outlinePath: string;
  notionId: string;
  title: string;
  url: string;
}

interface CalloutMapping {
  emoji: string;
  color: string;
}

export class MarkdownToNotionConverter {
  private pageMap: Map<string, PageMapping>;
  private s3Uploader: S3Uploader;
  private readonly CALLOUT_TYPES: Record<string, CalloutMapping> = {
    tip: { emoji: '💡', color: 'yellow_background' },
    success: { emoji: '✅', color: 'green_background' },
    warning: { emoji: '⚠️', color: 'orange_background' },
    info: { emoji: 'ℹ️', color: 'blue_background' }
  };

  constructor(pageMap: Map<string, PageMapping>) {
    this.pageMap = pageMap;
    this.s3Uploader = new S3Uploader();
  }

  private async uploadImageToS3(imagePath: string): Promise<string | null> {
    try {
      const s3Url = await this.s3Uploader.uploadFile(imagePath);
      console.log(`>> Uploaded image to S3: ${s3Url}`);
      return s3Url;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        console.error(`File not found: ${imagePath}`);
      } else {
        console.error('Error uploading image:', error);
      }
      return null;
    }
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

  private detectPasswordInLine(line: string): boolean {
    const passwordPatterns = [
      /(?:mot\s+de\s+passe|password)\s*[:=]\s*\S+/i,
      /(?:mdp|pwd)\s*[:=]\s*\S+/i
    ];
    return passwordPatterns.some(pattern => pattern.test(line));
  }


  private cleanMarkdownContent(content: string, filePath: string): string {
    const fileName = path.basename(filePath);
    let cleanedContent = content
      .split('\n')
      .filter(line => !/^\s*(\*\s*)?\\+\s*$/.test(line))
      .map(line => {
        if (this.detectPasswordInLine(line)) {
          console.warn(`⚠️ WARNING: Possible password detected in ${fileName}:`, line);
        }
        line = line.replace(/^\*\*\* /, '* ** ');
        return line.replace(/==([^=]+)==/g, '$1');
      })
      .join('\n');
    
    return cleanedContent;
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

  private async processMarkdownLinks(content: string, mdFilePath: string): Promise<string> {
    const mdDir = path.dirname(mdFilePath);
    
    // Process links with regex, but handle them asynchronously
    const matches = Array.from(content.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g));
    let processedContent = content;

    for (const match of matches) {
      const [fullMatch, text, url] = match;
      let replacement = fullMatch;

      if (url.startsWith('./') || url.startsWith('/') || url.includes('outline.incubateur.anct.gouv.fr')) {
        // Handle internal/outline links
        const normalizedPath = this.normalizeOutlinePath(url, mdFilePath);
        const mappedPage = this.findMappedPage(normalizedPath);
        if (mappedPage) {
          replacement = `[${text}](${mappedPage.url})`;
          console.log(`>> Processing link: ${url} -> ${replacement}`);
        } else {
          replacement = `${text} - ${url} - Impossible de reconstruire ce lien dans la migration vers Notion`;
          console.log(`>> Error processing link: ${url} -> ${replacement}`);
        }
      }


      processedContent = processedContent.replace(fullMatch, replacement);
    }

    return processedContent;
  }

  private async processMarkdownContent(content: string, mdFilePath: string): Promise<string> {
    const mdDir = path.dirname(mdFilePath);
    
    // Process images with regex, handling both title/alignment syntax
    const imageRegex = /!\[(.*?)\]\((uploads\/[^)]+?|public\/[^)]+?)(?:\s+"([^"]*)")?\)/g;
    let processedContent = content;
    
    // Process all images asynchronously
    const matches = Array.from(content.matchAll(imageRegex));
    
    for (const match of matches) {
      const [fullMatch, altText, imagePath, title] = match;
      let replacement = fullMatch;

      // Decode the image path to handle encoded characters
      const decodedImagePath = decodeURIComponent(imagePath);

      if (decodedImagePath.startsWith('uploads/') || decodedImagePath.startsWith('public/')) {
        const fullImagePath = path.join(mdDir, decodedImagePath);
        try {
          const s3Url = await this.uploadImageToS3(fullImagePath);
          if (s3Url) {
            // Preserve the title/alignment if it exists
            replacement = title 
              ? `![${altText}](${s3Url} "${title}")`
              : `![${altText}](${s3Url})`;
          }
        } catch (error) {
          console.error(`Failed to process image: ${decodedImagePath}`, error);
        }
      }

      console.log(`>> Processing image: ${decodedImagePath} -> ${replacement}`);
      processedContent = processedContent.replace(fullMatch, replacement);
    }

    // Process regular links after images
    processedContent = await this.processMarkdownLinks(processedContent, mdFilePath);

    return processedContent;
  }

  private processCalloutBlocks(blocks: any[]): any[] {
    const processedBlocks: any[] = [];
    let currentCallout: null | { type: string, firstBlock: any, children: any[] } = null;

    for (const block of blocks) {
      // Détecter le début d'un callout
      if (block.type === 'paragraph' && block.paragraph?.rich_text?.[0]?.text.content.match(/^:::(info|tip|warning|success)/)) {
        const [, type] = block.paragraph.rich_text[0].text.content.match(/^:::(info|tip|warning|success)/);
        const content = block.paragraph.rich_text[0].text.content.replace(/^:::(info|tip|warning|success)\s*/, '');
        currentCallout = { 
          type,
          firstBlock: content ? [{
            ...block.paragraph.rich_text[0],
            text: { content }
          }] : [],
          children: []
        };
        continue;
      }

      // Détecter la fin d'un callout
      if (block.type === 'paragraph' && block.paragraph?.rich_text?.[0]?.text.content === ':::') {
        if (currentCallout) {
          processedBlocks.push({
            type: 'callout',
            callout: {
              rich_text: currentCallout.firstBlock,
              icon: {
                type: 'emoji',
                emoji: this.CALLOUT_TYPES[currentCallout.type].emoji
              },
              color: this.CALLOUT_TYPES[currentCallout.type].color,
              children: currentCallout.children
            }
          });
          currentCallout = null;
        }
        continue;
      }

      // Accumuler les blocs dans le callout courant ou les ajouter directement
      if (currentCallout) {
        currentCallout.children.push(block);
      } else {
        processedBlocks.push(block);
      }
    }

    return processedBlocks;
  }

  public async convertMarkdownToNotionBlocks(content: string, mdFilePath: string) {
    const cleanedContent = this.cleanMarkdownContent(content, mdFilePath);
    const processedContent = await this.processMarkdownContent(cleanedContent, mdFilePath);

    try {
      const blocks = markdownToBlocks(processedContent);
      const blocksWithCallouts = this.processCalloutBlocks(blocks);
      
      // Traiter les tables
      return await Promise.all(blocksWithCallouts.map(async (block: any) => {
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