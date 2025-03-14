import * as fs from 'fs';
import * as path from 'path';
import * as util from 'util';
import { MarkdownToNotionConverter } from '../markdownToNotion';
import { NotionClient, PageMapping } from '../notionClient';
import { processNotionContent, createNotionPage, createNotionFolder } from '../notionProcessor';
import logger from '../utils/logger';
import { RateLimiter } from '../utils/rateLimiter';

const readdir = util.promisify(fs.readdir);
const readFile = util.promisify(fs.readFile);

const rateLimiter = new RateLimiter();

const notionClient = new NotionClient(process.env.NOTION_API_KEY || '', rateLimiter);

const pageMap = new Map<string, PageMapping>();

const converter = new MarkdownToNotionConverter(pageMap);

const countProcessableFiles = async (directoryPath: string): Promise<number> => {
  let count = 0;
  const entries = await readdir(directoryPath, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(directoryPath, entry.name);
    if (['uploads', 'public'].includes(entry.name)) continue;
    
    if (entry.isDirectory()) {
      count += await countProcessableFiles(fullPath);
    } else if (entry.isFile() && path.extname(entry.name) === '.md') {
      count++;
    }
  }
  
  return count;
};

async function processDirectory(
  directoryPath: string, 
  parentPageId: string, 
  phase: 'create' | 'update',
  totalFiles: number,
  processedSoFar: { count: number }
) {
  try {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    let processedPages = 0;

    if (['uploads', 'public'].includes(path.basename(directoryPath))) {
      logger.debug('Skipping directory:', { directoryPath });
      return;
    }

    const currentFolderName = path.basename(directoryPath);
    const foldersContentFiles = entries
      .filter((entry: { isDirectory: () => any; name: string; }) => entry.isDirectory() && entry.name !== 'uploads' && entry.name !== 'public')
      .map((entry: { name: string; }) => path.join(directoryPath, `${entry.name}.md`));

    if (phase === 'create') {
      let currentFolderPageId: string;
      try {
        currentFolderPageId = currentFolderName === process.env.OUTLINE_EXPORT_PATH 
          ? parentPageId 
          : await createNotionFolder(directoryPath, parentPageId, notionClient, pageMap, []);
      } catch (error) {
        logger.error('Error creating folder, using parent ID as fallback:', { 
          error,
          directoryPath,
          parentPageId
        });
        currentFolderPageId = parentPageId;
      }

      const processingPromises = entries.map(async entry => {
        const fullPath = path.join(directoryPath, entry.name);
        
        try {
          if (entry.isDirectory() && !['uploads', 'public'].includes(entry.name)) {
            await processDirectory(fullPath, currentFolderPageId, 'create', totalFiles, processedSoFar).catch(error => {
              logger.error('Error processing subdirectory, continuing with next entry:', { 
                error,
                fullPath,
                phase: 'create'
              });
            });
          } else if (entry.isFile() && path.extname(entry.name) === '.md') {
            if (foldersContentFiles.includes(fullPath)) {
              logger.debug('Skipping folder content file:', { fullPath });
              return;
            }

            const title = decodeURIComponent(path.basename(fullPath, '.md'));
            
            await createNotionPage(fullPath, title, currentFolderPageId, notionClient, pageMap).catch(error => {
              logger.error('Error creating notion page, continuing with next entry:', { 
                error,
                fullPath,
                title,
                currentFolderPageId
              });
            });
            processedSoFar.count++;
            const percentage = ((processedSoFar.count / totalFiles) * 100).toFixed(2);
            logger.info(`Progress (${phase} phase): ${percentage}% (${processedSoFar.count}/${totalFiles}) - Notion API rate: ${rateLimiter.getTasksPerSecond(10)} tps over last 10s`);
          }
          processedPages++;
        } catch (error) {
          logger.error('Error processing entry, continuing with next:', { 
            error,
            entry: entry.name,
            directoryPath
          });
        }
      });

      await Promise.all(processingPromises);
    }
    // Phase 2: Update pages with content
    else if (phase === 'update') {
      const currentFolderPageId = pageMap.get(directoryPath + '.md')?.notionId || parentPageId;

      const processingPromises = entries.map(async entry => {
        const fullPath = path.join(directoryPath, entry.name);

        try {
          if (entry.isDirectory() && !['uploads', 'public'].includes(entry.name)) {
            await processDirectory(fullPath, currentFolderPageId, 'update', totalFiles, processedSoFar).catch(error => {
              logger.error('Error processing subdirectory in update phase, continuing:', { 
                error,
                fullPath,
                phase: 'update'
              });
            });
          } else if (entry.isFile() && path.extname(entry.name) === '.md') {
            const mapping = pageMap.get(fullPath);
            if (mapping) {
              try {
                const content = await readFile(fullPath, 'utf8');
                await processNotionContent(content, fullPath, mapping.notionId, notionClient, converter).catch(error => {
                  logger.error('Error processing notion content, continuing:', { 
                    error,
                    fullPath,
                    notionId: mapping.notionId
                  });
                });
                processedSoFar.count++;
                const percentage = ((processedSoFar.count / totalFiles) * 100).toFixed(2);
                logger.info(`Progress (${phase} phase): ${percentage}% (${processedSoFar.count}/${totalFiles}) - Notion API rate: ${rateLimiter.getTasksPerSecond(30)} rps over last 30s`);
              } catch (error) {
                logger.error('Error reading file, continuing with next:', { 
                  error,
                  fullPath
                });
              }
            }
          }
          processedPages++;
        } catch (error) {
          logger.error('Error processing entry in update phase, continuing:', { 
            error,
            entry: entry.name,
            directoryPath
          });
        }
      });

      await Promise.all(processingPromises);
    }
  } catch (error) {
    logger.error('Error in processDirectory, continuing with parent process:', { 
      error,
      directoryPath,
      phase
    });
  }
}

async function main() {
  try {
    const outlinePath = process.env.OUTLINE_EXPORT_PATH;
    const destinationPageId = process.env.NOTION_DESTINATION_PAGE_ID;

    if (!outlinePath || !destinationPageId) {
      logger.error('Missing required environment variables');
      process.exit(1);
    }

    const totalFiles = await countProcessableFiles(outlinePath);
    logger.info(`Found ${totalFiles} files to process`);

    logger.info("Starting migration phase 1: Creating empty pages...");
    await processDirectory(outlinePath, destinationPageId, 'create', totalFiles, { count: 0 });

    logger.info("Starting migration phase 2: Updating content with proper links...");
    await processDirectory(outlinePath, destinationPageId, 'update', totalFiles, { count: 0 });

    logger.info("Migration completed!");
  } catch (error) {
    logger.error('Fatal error in migration, but process completed as much as possible:', { error });
  }
}

main();
