# Deploying the demo

The hosted demo is one small AWS instance that runs the same `compose.yaml` as a laptop, plus Caddy in front for HTTPS (`deploy/compose.box.yaml`, `deploy/Caddyfile`). Terraform in `deploy/terraform` creates it; the instance's first boot does the rest. Nothing is copied to it by hand: it clones this repository, builds the image, and the app fills its empty database from Zenodo, as it does locally ([DESIGN.md](DESIGN.md#http-api)).

## What it creates, and what it costs

In `us-west-2`, in the account's default VPC:

| Resource | Why |
|---|---|
| One `t4g.micro` instance (Graviton, 1 GB), Ubuntu 24.04 arm64, 20 GB encrypted gp3 disk | PostgreSQL, the app and Caddy, with a 2 GB swap file |
| An Elastic IP | A fixed address, so the demo's name, `<address with dashes>.sslip.io`, never changes |
| A security group | 80 and 443 in, for Caddy; 80 and 443 out, for packages, GitHub, Docker Hub, Maven Central, npm, Zenodo and the certificate authority |
| An IAM role with `AmazonSSMManagedInstanceCore` | Session Manager shells, so the box has no SSH port or key |

On-demand prices from the AWS price list for `us-west-2`, checked 2026-09-19, for a 730-hour month:

| | `t4g.micro` | `t4g.small` |
|---|---:|---:|
| Instance | $6.13 ($0.0084/h) | $12.26 ($0.0168/h) |
| Public IPv4 address, charged whether attached or idle | $3.65 ($0.005/h) | $3.65 |
| 20 GB gp3 disk | $1.60 ($0.08 per GB-month) | $1.60 |
| **Total** | **about $11.40 a month** | **about $17.50 a month** |

Traffic out stays inside the free 100 GB a month. The account's credits pay for it; the micro fits under a $15 monthly budget and the small does not. Billing starts at `terraform apply` and stops at `terraform destroy`.

## Before the first apply

- Terraform 1.16 and the AWS CLI, logged in to the account that will pay (`aws sts get-caller-identity` shows it).
- The Session Manager plugin for the AWS CLI, for shells on the box.
- In `deploy/terraform`, copy `terraform.tfvars.example` to `terraform.tfvars` (git ignores it) and set `account_id`. The provider refuses every other account.

State stays in `deploy/terraform` on the machine that applies it, also ignored by git. Keep it: `terraform destroy` needs it. If it is ever lost, every resource carries the tag `Project = chamberwatch`, and the console's Tag Editor finds them.

## Apply

```bash
cd deploy/terraform
terraform init
terraform plan -out tfplan      # 7 to add: role, policy attachment, instance profile, security group, Elastic IP, instance, association
terraform apply tfplan
terraform output                # url, public_ip, instance_id, session_command
```

## The first boot

cloud-init installs Docker, turns on the swap, clones `main` into `/opt/chamberwatch`, builds the image on the box and starts the stack. Then the app's bootstrap fetches the public files from Zenodo, loads them and stores the simulated demo lot, while Caddy gets a certificate for the sslip.io name. The page answers as soon as the app is up, and its tables fill in as the bootstrap goes.

Follow it from a shell on the box (`terraform output -raw session_command`):

```bash
sudo tail -f /var/log/cloud-init-output.log          # packages, swap, clone, build; "chamberwatch up" at the end
cd /opt/chamberwatch
sudo docker compose -f compose.yaml -f deploy/compose.box.yaml --env-file /etc/chamberwatch.env logs -f app caddy
```

For reference, on the development PC (x86, 22 threads) the image builds in 165 s from a cold cache and in 226 s with every build step held to 900 MB of memory and no swap, so the build fits a 1 GB box; and the bootstrap takes 68 to 74 s from empty volumes under the compose file's caps of 640 MB for the app and 256 MB for PostgreSQL, peaking at 352 MiB and 203 MiB. A burstable Graviton core is slower, so expect several times longer on the box.

## Measure before linking the demo

Before the README links the demo, take these on the box and write them into this file:

1. **First boot**: the time from the `chamberwatch build start` line to `chamberwatch up` in `/var/log/cloud-init-output.log`, and the bootstrap's own lines in the app's log, `fetching` to `bootstrap done`. If the build or the bootstrap fails, that is the answer.
2. **Memory under use**: open the runs table, a flagged run (`/runs/55`), a simulated run (`/runs/133`), the lots page and a wafer map a few times, then `free -m`, `swapon --show` and `sudo docker stats --no-stream`.
3. **Page loads, cold and warm**: from your own machine, for example `curl -s -o /dev/null -w '%{time_total}\n' https://<name>/api/runs` twice, and the same for `/api/runs/55` and `/api/lots/6/drift`, right after a restart and again after a few loads.

If pages stall for seconds, or the swap is busy while nothing is loading, 1 GB is too tight: set `instance_type = "t4g.small"` in `terraform.tfvars` and apply. Terraform stops the instance, changes its type and starts it again, a few minutes without the demo; the disk and the loaded database stay, so the app comes back with its data and its bootstrap does nothing.

## If the page does not come up

- **No answer on 80 or 443**: the build is still running or failed. `/var/log/cloud-init-output.log` says which; `sudo docker compose ... ps` shows the containers.
- **A certificate error in the browser**: Caddy's log says why. sslip.io is not on the Public Suffix List, so every sslip.io user shares one Let's Encrypt limit on certificates for the domain; Let's Encrypt has raised it for sslip.io, but a refusal for that reason is possible. Caddy keeps retrying with backoff. Another way out is a `{ email ... }` block at the top of `deploy/Caddyfile`, which lets Caddy fall back to ZeroSSL; it puts an address in the file, so it is left out here.
- **The app answers but the tables are empty**: the bootstrap is still loading, or failed and will retry after 1, 5, 15 and 60 minutes. The app's log shows `bootstrap:` lines and any error.

## Update

The box builds whatever `main` holds when it pulls. From a shell on the box:

```bash
sudo sh /opt/chamberwatch/deploy/update.sh
```

It pulls, rebuilds, restarts the changed containers and prunes old images. The data volumes stay, so the app restarts on the loaded database and its bootstrap does nothing.

A change to `deploy/terraform/cloud-init.yaml`, the branch or the swap size is a change to the first boot, so the next apply replaces the instance, and the new one starts from empty.

## Destroy

```bash
cd deploy/terraform
terraform destroy
```

Everything goes, the database included; the next apply rebuilds it from Zenodo. Releasing the Elastic IP ends its hourly charge.
