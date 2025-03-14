# Migrate Outline to Notion
Migration tool to migrate from outline to notion

## How to perform the migration

### Export from Outline

From Outline admin panel, export the data in Markdown format with attachments.

![OutlineExport](./doc/images/OutlineExport.png)

### Setup Notion

1. Create a new integration in Notion [on this screen](https://www.notion.so/profile/integrations/form/new-integration) and save the token for later

![NotionIntegrationCreation](./doc/images/NotionIntegrationCreation.png)
![NotionIntegrationParameters](./doc/images/NotionIntegrationParameters.png)

2. Create a new page in Notion and configure the integration on this page

![NotionIntegrationPageConfiguration](./doc/images/NotionIntegrationPageConfiguration.png)

### Run the migration

```bash
# Clone the repository
git clone git@github.com:incubateur-territoires/migrate-outline-to-notion.git

# Go to the project directory
cd migrate-outline-to-notion

# Copy the environment variables file and adapt it
cp .env.template .env

# Run the migration
npm run migrate
```

### Set up env variables
Create a .env file in this repository by copying `.env.template`. The configuration is divided into several sections:

#### Notion Configuration
- `NOTION_API_KEY`: `Internal Integration Secret` from your integration
- `NOTION_DESTINATION_PAGE_ID`: the id of the page you want to import outline data in. It is the UUID part in the Notion page link, without "-" characters. For example, for `https://www.notion.so/test-page-1ad84dabc4ba976eb15be333148cc4c6`, id is going to be `1ad84dabc4ba976eb15be333148cc4c6`

#### Outline Configuration
- `OUTLINE_EXPORT_PATH`: path of the folder on your machine in that you exported the Outline data from the archive.

#### File Storage Strategy
You have two options for handling file attachments (images, documents, etc.):

1. **Use Original Outline Bucket** (recommended if you still have access to your Outline storage)
   - Set `USE_ORIGINAL_BUCKET=true`
   - Set `ORIGINAL_BUCKET_END_POINT` to your Outline bucket URL (e.g., https://your-outline-bucket.s3.region.amazonaws.com)
   - No need to configure AWS/S3 settings

2. **Upload to New Bucket**
   - Keep `USE_ORIGINAL_BUCKET=false`
   - Configure the AWS/S3 settings below

#### AWS/S3 Configuration (Only if using new bucket)
Required if `USE_ORIGINAL_BUCKET=false`:
- `AWS_REGION`: Your S3 region
- `AWS_S3_BUCKET`: Your S3 bucket name
- `AWS_ACCESS_KEY_ID`: Your S3 access key
- `AWS_SECRET_ACCESS_KEY`: Your S3 secret key
- `AWS_ENDPOINT`: Optional custom endpoint URL if not using AWS S3 (e.g., for Scaleway)
