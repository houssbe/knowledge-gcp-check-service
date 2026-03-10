---
description: Build and deploy the application to GCP Cloud Run
---

# GCP Cloud Run Deployment Workflow

This workflow leverages the `cloudrun` MCP server to directly deploy the local workspace to Cloud Run. It also autonomously applies best practices from the `gcp-cloud-run` skill.

## Prerequisites

Ensure your `.env` file contains the following variables:
- `GCP_PROJECT_ID`
- `GCP_REGION_AI`
- `GCP_REGION_HOSTING`
- `SERVICE_NAME`

1. Read the `.env` file to obtain the `GCP_PROJECT_ID`, `GCP_REGION_AI`, `GCP_REGION_HOSTING`, and `SERVICE_NAME`.

2. Validate that the project aligns with the `gcp-cloud-run` skill:
   - Ensure the `Dockerfile` uses a multi-stage pattern or is optimized for a smaller image.
   - Look for any anti-patterns in the source code (e.g., writing large files to `/tmp`).

3. Call the `mcp_cloudrun_deploy_local_folder` MCP server tool to deploy the code. You MUST provide:
   - `folderPath`: The absolute path to this project workspace.
   - `project`: The `GCP_PROJECT_ID` from the `.env` file.
   - `region`: The `GCP_REGION_HOSTING` from the `.env` file.
   - `service`: The `SERVICE_NAME` from the `.env` file.

4. **Crucial Next Step**: After deployment, use the `run_command` tool to set the required environment variables and activate **Direct VPC Egress** on the deployed Cloud Run service:
   ```bash
   gcloud run services update <SERVICE_NAME> \
     --update-env-vars GCP_PROJECT_ID=<GCP_PROJECT_ID>,GCP_REGION_AI=<GCP_REGION_AI>,INSTANCE_HOST=<INSTANCE_HOST>,DB_PORT=<DB_PORT>,DB_USER=<DB_USER>,DB_PASS=<DB_PASS>,DB_NAME=<DB_NAME> \
     --network=gcp-check-vpc \
     --subnet=gcp-check-subnet \
     --vpc-egress=private-ranges-only \
     --region=<GCP_REGION_HOSTING> \
     --project=<GCP_PROJECT_ID>
   ```

5. Verify the deployment and environment updates were successful by fetching the service logs using the `mcp_cloudrun_get_service_log` tool.

