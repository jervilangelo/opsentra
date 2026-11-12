#!/usr/bin/env bash
# Create (or reset) one Opsentra test user in a Cognito group.
#
# Usage (Git Bash):
#   export OPSENTRA_USER_POOL_ID=ap-southeast-1_xxxxxxxxx
#   export OPSENTRA_TEST_PASSWORD='...'        # set it yourself; never commit it
#   scripts/bootstrap/create-test-user.sh <username> <viewer|operator|admin>
#
# This writes to AWS (Cognito). Run it only after the owner approves.
# It prints no password, token or account ID.
set -euo pipefail

username="${1:?usage: create-test-user.sh <username> <viewer|operator|admin>}"
group="${2:?usage: create-test-user.sh <username> <viewer|operator|admin>}"
pool="${OPSENTRA_USER_POOL_ID:?set OPSENTRA_USER_POOL_ID}"
: "${OPSENTRA_TEST_PASSWORD:?set OPSENTRA_TEST_PASSWORD}"
region="ap-southeast-1"

case "$group" in
  viewer|operator|admin) ;;
  *) echo "group must be viewer, operator or admin" >&2; exit 2 ;;
esac

if ! aws cognito-idp admin-get-user --region "$region" --user-pool-id "$pool" --username "$username" >/dev/null 2>&1; then
  aws cognito-idp admin-create-user --region "$region" --user-pool-id "$pool" \
    --username "$username" --message-action SUPPRESS >/dev/null
  echo "created user $username"
fi

# Permanent password, so AdminInitiateAuth works without a reset challenge.
aws cognito-idp admin-set-user-password --region "$region" --user-pool-id "$pool" \
  --username "$username" --password "$OPSENTRA_TEST_PASSWORD" --permanent >/dev/null

aws cognito-idp admin-add-user-to-group --region "$region" --user-pool-id "$pool" \
  --username "$username" --group-name "$group" >/dev/null

echo "user $username is in group $group"
