import { NotionClient } from '../notionClient';
import { MarkdownToNotionConverter } from '../markdownToNotion';
import { processNotionContent } from '../notionProcessor';
import * as fs from 'fs';
import logger from '../utils/logger';

async function main() {
  try {
    const notionClient = new NotionClient(process.env.NOTION_API_KEY || '');
    const converter = new MarkdownToNotionConverter(new Map());

    const content = fs.readFileSync(process.env.TEST_FILE || '', 'utf8');
    const pageId = process.env.TEST_PAGE_ID || '';

    logger.info('Starting test conversion:', {
      pageId,
      contentLength: content.length
    });

    await processNotionContent(content, 'test.md', pageId, notionClient, converter);
    logger.info('Test conversion completed successfully');
  } catch (error) {
    logger.error('Test conversion failed:', { error });
    process.exit(1);
  }
}

main();