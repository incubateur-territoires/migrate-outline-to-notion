const { Client } = require("@notionhq/client")
const fs = require('fs');
const path = require('path');
const util = require('util');
const { markdownToBlocks } = require("@tryfabric/martian");

const readdir = util.promisify(fs.readdir);
const readFile = util.promisify(fs.readFile);
const stat = util.promisify(fs.stat);

const notion = new Client({ auth: process.env.NOTION_API_KEY });

interface PageMapping {
  outlinePath: string;
  notionId: string;
  title: string;
  url: string;
}

const pageMap = new Map<string, PageMapping>();

async function uploadImageToNotion(imagePath: string): Promise<string | null> {
  try {
    const imageBuffer = await readFile(imagePath);
    const response = await notion.files.create({
      file: {
        name: path.basename(imagePath),
        content: imageBuffer
      },
      parent: { workspace: true }
    });
    return response.url;
  } catch (error) {
    console.error('Error uploading image:', imagePath, error);
    return null;
  }
}

async function findImageInUploads(mdFilePath: string, imageName: string): Promise<string | null> {
  const mdDir = path.dirname(mdFilePath);
  const possiblePaths = [
    path.join(mdDir, 'uploads', imageName),
    path.join(mdDir, '..', 'uploads', imageName),
    // Ajoutez d'autres chemins possibles si nécessaire
  ];

  for (const imgPath of possiblePaths) {
    if (fs.existsSync(imgPath)) {
      return imgPath;
    }
  }
  return null;
}

const normalizeTableRowBlocks = (tableRowBlocks: any[]): any[] => {
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
};

const cleanMarkdownContent = (content: string): string => {
  // Remove lines that only contain whitespace and backslashes
  return content
    .split('\n')
    .filter(line => !/^\s*\\+\s*$/.test(line))
    .join('\n');
};

const convertMarkdownToNotionBlocks = async (content: string, mdFilePath: string) => {
  // Clean the content before processing
  const cleanedContent = cleanMarkdownContent(content);
    
  // Prétraiter le contenu pour remplacer les liens
  const processedContent = cleanedContent.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (match, text, url) => {

      // Pour les liens relatifs ou absolus
      if (url.startsWith('./') || url.startsWith('/') || url.includes('outline.incubateur.anct.gouv.fr')) {
        const normalizedPath = normalizeOutlinePath(url, mdFilePath);
        const mappedPage = findMappedPage(normalizedPath);

        if (mappedPage) {
          return `[${text}](${mappedPage.url})`;
        }
      }

      // Si aucune correspondance n'est trouvée, retourner le texte sans lien
      return text;
    }
  );

  try {

    const blocks = markdownToBlocks(processedContent);

    const processedBlocks = await Promise.all(blocks.map(async (block: any) => {
      // Gérer les blocs d'image
      if (block.type === 'image') {
        const imagePath = block.image?.external?.url || block.image?.file?.url;
        if (imagePath) {
          // Supprimer les préfixes de protocole si présents
          const cleanImagePath = imagePath.replace(/^(file:\/\/|https?:\/\/)/, '');
          const fullImagePath = await findImageInUploads(mdFilePath, cleanImagePath);
          
          if (fullImagePath) {
            const notionUrl = await uploadImageToNotion(fullImagePath);
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
      
      // Normalisation améliorée des tables
      if (block.type === 'table') {
        const normalizedRows = normalizeTableRowBlocks(block.table?.children);
        
        // Si la table est invalide (vide ou mal formée), on la convertit en paragraphe
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
};

async function createNotionFolder(directoryPath: string, parentPageId: string, children: any[] = []) {

    const folderName = path.basename(directoryPath);

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
  try {
    const response = await notion.pages.create(notionPage);
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
    console.log(`Notion page:`, notionPage);
    return parentPageId;
  }
}

const normalizeOutlinePath = (url: string, currentFile: string): string => {
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
};

const findMappedPage = (normalizedPath: string): PageMapping | undefined => {
  for (const [outlinePath, mapping] of pageMap.entries()) {
    if (normalizedPath.includes(encodeURIComponent(path.basename(outlinePath)))) {
      return mapping;
    }
  }
  return undefined;
};

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


    for (const entry of entries) {
      if (processedPages >= MAX_PAGES) break;

      const fullPath = path.join(directoryPath, entry.name);
      
      if (entry.isDirectory() && entry.name !== 'uploads') {
        await processDirectory(fullPath, currentFolderPageId, 'create');
      } else if (entry.isFile() && path.extname(entry.name) === '.md') {
        // Skip creating pages for folder content files
        if (foldersContentFiles.includes(fullPath)) {
          console.log('Skipping folder content file:', fullPath);
          continue;
        }

        const title = path.basename(fullPath, '.md');
        
        const notionPage = {
            parent: { page_id: currentFolderPageId },
            properties: {
                title: {
                title: [{ text: { content: title } }]
                }
            }
        };

        try {
            const response = await notion.pages.create(notionPage);
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
      }
    }
  }
  // Phase 2: Update pages with content
  else if (phase === 'update') {
    const currentFolderPageId = pageMap.get(directoryPath)?.notionId || parentPageId;

    // Then process regular pages
    for (const entry of entries) {
      if (processedPages >= MAX_PAGES) break;

      const fullPath = path.join(directoryPath, entry.name);

      if (entry.isDirectory() && entry.name !== 'uploads') {
        await processDirectory(fullPath, currentFolderPageId, 'update');
      } else if (entry.isFile() && path.extname(entry.name) === '.md') {
        const mapping = pageMap.get(fullPath);
        if (mapping) {
          const content = await readFile(fullPath, 'utf8');
          const blocks = await convertMarkdownToNotionBlocks(content, fullPath);

            const chunks = [];
            for (let i = 0; i < blocks.length; i += 100) {
              chunks.push(blocks.slice(i, i + 100));
            }
          
            // Ajouter les blocs par lots de 100
            for (let i = 0; i < chunks.length; i++) {
              try {
                await notion.blocks.children.append({
                  block_id: mapping.notionId,
                  children: chunks[i]
                });
                console.log(`> Appended blocks chunk ${i + 1}/${chunks.length} for ${fullPath}`);
              } catch (error) {
                console.error(`Error appending blocks chunk ${i + 1} for ${fullPath}:`, error);
                console.log('> Blocks:', JSON.stringify(chunks[i], null, 2));
              }
            }
        }
      }
    }
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
