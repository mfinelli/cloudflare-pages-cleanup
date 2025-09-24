# cloudflare-pages-cleanup

Deletes old [Cloudflare Pages](https://pages.cloudflare.com) deployments with
min/max retention, optional age threshold, **alias & active production
protection**, strict failure on errors, and always emits a `report.json`
artifact.

## Inputs

| Name                                   | Type                                   | Description                                                                                                                   | Default |
| -------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------- |
| `cloudflare_account_id` (**required**) | String                                 | Cloudflare Account ID                                                                                                         |         |
| `cloudflare_api_token` (**required**)  | String                                 | Cloudflare API token with Pages read+edit permissions                                                                         |         |
| `project` (**required**)               | String                                 | Cloudflare Pages project name                                                                                                 |         |
| `environment`                          | Enum: (`all`, `production`, `preview`) | Which environment(s) to clean. When all, production and preview are handled independently                                     | `all`   |
| `min-to-keep`                          | Integer (>= 0)                         | Per environment floor of most-recent deployments to always keep                                                               | `5`     |
| `max-to-keep`                          | Integer (>= 0)                         | Per environment cap of most-recent deployments to retain -- if set lower than `min-to-keep`, it's coerced up to `min-to-keep` | `10`    |
| `only-older-than-days`                 | Integer (>= 0)                         | Only delete candidates older than this many days -- if unset, age is ignored                                                  |         |
| `dry_run`                              | Boolean                                | If `true`, no deletions—just report what would be deleted                                                                     | `false` |
| `max-deletes-per-run`                  | Integer (>= 0)                         | Safety valve: maximum number of deletions to perform in a single run                                                          | `50`    |
| `fail_on_error`                        | Boolean                                | If `true`, any deletion error causes the job to fail (after reporting)                                                        | `true`  |

> [!IMPORTANT]
>
> The Cloudflare API token must have Read+Edit permissions for the Pages project
> that you want to manage.

> [!TIP]
>
> We only support running for a single project within this action. If you need
> to clean multiple projects then run this action multiple times, once for each
> project.

Given the above settings to prune old releases the following two conditions are
always true:

- Active production deployment is always protected (resolved via
  `canonical_deployment` with a heuristic fallback).
- Any deployment with aliases/custom domains is always protected.

## Outputs

| Name              | Type    | Description                                                                   |
| ----------------- | ------- | ----------------------------------------------------------------------------- |
| `consideredCount` | Integer | Number of candidates examined beyond the retention window (after protections) |
| `deletedCount`    | Integer | Number of deployments deleted in this run                                     |
| `keptCount`       | Integer | Number of deployments kept (includes protected and within retention)          |
| `deletedIds`      | String  | Comma-separated list of deleted deployment IDs                                |

## Example Usage

You can run this action on a schedule, workflow dispatch, or part of a normal
workflow that runs on push or pull request:

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

## Notes

Cloudflare documentation for the endpoints that we use:

- https://developers.cloudflare.com/api/resources/pages/subresources/projects/subresources/deployments/methods/list/
- https://developers.cloudflare.com/api/resources/pages/subresources/projects/subresources/deployments/methods/delete/
