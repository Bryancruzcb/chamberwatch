#!/bin/sh
# Pulls the branch the box follows and rebuilds the image on the box. Run it there, for example
#   aws ssm start-session --region us-west-2 --target <instance id>
#   sudo sh /opt/chamberwatch/deploy/update.sh
# The data volumes stay, so the app restarts on the loaded database and its bootstrap does nothing.
set -eu
cd /opt/chamberwatch
git pull --ff-only
docker compose -f compose.yaml -f deploy/compose.box.yaml --env-file /etc/chamberwatch.env up --detach --build
docker image prune --force
