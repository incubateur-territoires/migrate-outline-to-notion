const { Client } = require("@notionhq/client")

const notion = new Client({ auth: process.env.NOTION_API_KEY });

async function main() {
    const response = await notion.blocks.children.list({
        block_id: "15b744bf-03dd-8069-8aca-f658137fdfe6"//process.env.NOTION_DESTINATION_PAGE_ID,
    });
    console.log(JSON.stringify(response, null, 2));
}

main();