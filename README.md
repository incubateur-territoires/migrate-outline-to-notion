# Migrate Outline to Notion
Migration tool to migrate from outline to notion

# Set up an API key for notion
Go to [https://www.notion.so/profile/integrations](https://www.notion.so/profile/integrations) and create a new internal integration. You will need `Internal Integration Secret` later.

# Connect a page with the integration
For the integration to have access to a page, you have to connect the integration to a certain page.
Navigate to the page you want to import your Outline files, and in the page on the very top right corner, click the three dots (...) -> Connections -> \<your integration name\>, click and connect it.

# Export outline 
Go to [https://\<your-outline-ur\>/settings/export](https://\<your-outline-ur\>/settings/export) with your admin account and export all data as Markdown. You will get an email with the download link. Download the archived files, and export its contents somewhere on your local machine.

# Set up env variables
Create a .env file in this repository, and set following environment variables:
- NOTION_API_KEY: `Internal Integration Secret` from your integration
- NOTION_DESTINATION_PAGE_ID: the id of the page you want to import outline data in. It is the UUID part in the Notion page link, without "-" characters. For example, for `https://www.notion.so/test-page-1ad84dabc4ba976eb15be333148cc4c6`, id is going to be `1ad84dabc4ba976eb15be333148cc4c6`
- OUTLINE_EXPORT_PATH: path of the folder on your machine in that you exported the Outline data from the archive.

# Start the script
- Install npm packages with `npm install`
- run the script `npm run migrate`