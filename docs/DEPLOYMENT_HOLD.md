# Deployment hold

Automatic Git deployments are temporarily disabled in `vercel.json` while I finish the guarded canvas rollout. Manual Vercel CLI preview deployments still work.

The existing production deployment serves the tellhon.com placeholder. Connecting this clean repository must not promote the canvas to production or move its custom domains. The temporary production firewall rule blocks only `/api` paths on the three reviewed production hosts.

Before removing the hold, finish the reviewed live database migrations, configure the verified owner allowlists and server credentials, and check the signed-in preview and browser console. Verify which branch and environment each domain uses, then deliberately choose a production deployment. A Git push alone is not a release approval.

To resume automatic Git previews later, replace `git.deploymentEnabled` with an explicitly reviewed branch configuration or remove that setting after confirming the production branch. This setting does not disable manual CLI deployments, so do not use `vercel --prod` during the hold.
