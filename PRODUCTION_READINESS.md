# Deployment status

Hon is an experiment, not a production-certified service. The old completed checklist was not evidence of the current deployment's configuration.

Use [API setup](docs/API_ACCESS_SETUP.md), [SHARP setup](docs/SPLAT_SECURITY_SETUP.md), and [the current review](docs/PUBLICATION_REVIEW.md). Apply the owner/RLS and request-budget migrations in a test database first. Configure the protected API, client, storage and worker together, then test real sign-in and the intended tools before promoting a deployment.

Publishing the source does not deploy it, enable providers, or confirm historical keys are retired.
