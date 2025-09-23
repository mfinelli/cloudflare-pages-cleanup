# cloudflare-pages-cleanup

Deletes old Cloudflare Pages deployments with min/max retention, optional age
threshold, **alias & active production protection**, strict failure on errors,
and always emits a `report.json` artifact.

### Inputs

- `cloudflare_account_id` (required)
- `cloudflare_api_token` (required)
- `project` (required)
- `environment` (default: `all`) — `all|production|preview`
- `min-to-keep` (default: `5`) — per environment
- `max-to-keep` (default: `50`) — per environment
- `only-older-than-days` (optional)
- `dry_run` (default: `true`)
- `max-deletes-per-run` (default: `50`)
- `fail_on_error` (default: `true`)

### Example

```yaml
jobs:
  cleanup:
    runs-on: ubuntu-latest
    steps:
      - uses: mfinelli/cloudflare-pages-cleanup@v1
        with:
          cloudflare_account_id: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          cloudflare_api_token: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          project: my-pages-project
          dry_run: true
```
