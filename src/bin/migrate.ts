import * as fs from 'fs';
import * as path from 'path';
import * as util from 'util';
import { MarkdownToNotionConverter } from '../markdownToNotion';
import { NotionClient, PageMapping } from '../notionClient';

const readdir = util.promisify(fs.readdir);
const readFile = util.promisify(fs.readFile);
const stat = util.promisify(fs.stat);

const notionClient = new NotionClient(process.env.NOTION_API_KEY || '');

const pageMap = new Map<string, PageMapping>();

const converter = new MarkdownToNotionConverter(pageMap);

async function createNotionFolder(directoryPath: string, parentPageId: string, children: any[] = []) {
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
}

async function processDirectory(directoryPath: string, parentPageId: string, phase: 'create' | 'update') {
  /**
   * Directory entries are as follows:
   * - .md files are pages to be created
   * - folders are to be processed recursively and a .md page with the same name as the folder exists to represent the folder page content
   * Example:
   * - /docs.md # page representing the content of the /docs/ folder
   * - /docs/index.md
   * - /docs/getting-started.md
   * - /docs/advanced.md # page representing the content of the /docs/advanced/ folder
   * - /docs/advanced/index.md
   * - /docs/advanced/docs.md # sub-folders may have the same name as parent folders
   * - /docs/advanced/docs/index.md
   */
  const entries = await readdir(directoryPath, { withFileTypes: true });
  let processedPages = 0;
  const MAX_PAGES = 500;

  // Skip processing if this is an uploads directory
  if (path.basename(directoryPath) === 'uploads') {
    console.log('Skipping uploads directory:', directoryPath);
    return;
  }

  const currentFolderName = path.basename(directoryPath);
  const foldersContentFiles = entries
    .filter((entry: { isDirectory: () => any; name: string; }) => entry.isDirectory() && entry.name !== 'uploads')
    .map((entry: { name: string; }) => path.join(directoryPath, `${entry.name}.md`));

  // Phase 1: Create empty pages and store mappings
  if (phase === 'create') {
    const currentFolderPageId = currentFolderName === process.env.OUTLINE_EXPORT_PATH 
      ? parentPageId 
      : await createNotionFolder(directoryPath, parentPageId, []);

    const createPagePromises: Promise<void>[] = [];

    for (const entry of entries) {
      if (processedPages >= MAX_PAGES) break;

      const fullPath = path.join(directoryPath, entry.name);
      
      if (entry.isDirectory() && entry.name !== 'uploads') {
        createPagePromises.push(processDirectory(fullPath, currentFolderPageId, 'create'));
      } else if (entry.isFile() && path.extname(entry.name) === '.md') {
        if (foldersContentFiles.includes(fullPath)) {
          console.log('Skipping folder content file:', fullPath);
          continue;
        }

        const title = path.basename(fullPath, '.md');
        
        createPagePromises.push(
          (async () => {
            try {
              const response = await notionClient.createEmptyPage(title, currentFolderPageId);
              pageMap.set(fullPath, {
                outlinePath: fullPath,
                notionId: response.id,
                title,
                url: response.url
              });
              console.log(`Created empty page for ${fullPath}`);
              processedPages++;
            } catch (error) {
              console.error(`Error creating empty page for ${fullPath}:`, error);
            }
          })()
        );
      }
    }

    await Promise.all(createPagePromises);
  }
  // Phase 2: Update pages with content
  else if (phase === 'update') {
    const currentFolderPageId = pageMap.get(directoryPath + '.md')?.notionId || parentPageId;

    const updatePromises: Promise<void>[] = [];

    for (const entry of entries) {
      if (processedPages >= MAX_PAGES) break;

      const fullPath = path.join(directoryPath, entry.name);

      if (entry.isDirectory() && entry.name !== 'uploads') {
        updatePromises.push(processDirectory(fullPath, currentFolderPageId, 'update'));
      } else if (entry.isFile() && path.extname(entry.name) === '.md') {
        const mapping = pageMap.get(fullPath);
        if (mapping) {
          updatePromises.push(
            (async () => {
              const content = await readFile(fullPath, 'utf8');
              const blocks = await converter.convertMarkdownToNotionBlocks(content, fullPath);

              const chunks = [];
              for (let i = 0; i < blocks.length; i += 100) {
                chunks.push(blocks.slice(i, i + 100));
              }
            
              for (const chunk of chunks) {
                try {
                  await notionClient.appendBlocks(mapping.notionId, chunk);
                  console.log(`> Appended blocks chunk for ${fullPath}`);
                } catch (error) {
                  console.error(`Error appending blocks for ${fullPath}:`, error);
                }
              }
            })()
          );
        }
      }
    }

    await Promise.all(updatePromises);
  }
}

async function main() {
  const outlinePath = process.env.OUTLINE_EXPORT_PATH;
  const destinationPageId = process.env.NOTION_DESTINATION_PAGE_ID;

  if (!outlinePath || !destinationPageId) {
    throw new Error('Missing required environment variables: OUTLINE_EXPORT_PATH and/or NOTION_DESTINATION_PAGE_ID');
  }

  console.log("Starting migration phase 1: Creating empty pages...");
  await processDirectory(outlinePath, destinationPageId, 'create');

  console.log("Starting migration phase 2: Updating content with proper links...");
  await processDirectory(outlinePath, destinationPageId, 'update');

  console.log("Migration completed!");
}

main();
