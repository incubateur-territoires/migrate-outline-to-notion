const { Client } = require("@notionhq/client")

const notion = new Client({ auth: process.env.NOTION_API_KEY });

async function main() {
    const response = await notion.blocks.children.list({
        block_id: "144aa724-fdce-805d-a123-c60d77af41e5"//process.env.NOTION_DESTINATION_PAGE_ID,
    });
    console.log(JSON.stringify(response, null, 2));
}

main();