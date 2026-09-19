# The hosted demo: one small instance that runs PostgreSQL, the app and Caddy from compose.yaml and
# deploy/compose.box.yaml. docs/DEPLOY.md is the runbook.
#
# State stays in this folder on the machine that applies it (see .gitignore). Keep it: `terraform destroy`
# needs it, and every resource carries the Project tag if it is ever lost.

provider "aws" {
  region = local.region

  # Whatever credentials are loaded, refuse to touch any other account.
  allowed_account_ids = [var.account_id]

  default_tags {
    tags = {
      Project = local.project
    }
  }
}

locals {
  project = "chamberwatch"
  region  = "us-west-2"

  # sslip.io answers every name of this form with the address inside it, so the box needs no domain of its own.
  domain = "${replace(aws_eip.demo.public_ip, ".", "-")}.sslip.io"
}
