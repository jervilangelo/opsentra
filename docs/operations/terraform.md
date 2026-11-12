# Terraform operations

How the Opsentra AWS infrastructure is created, changed, recovered and torn down. Region `ap-southeast-1` only. **Every `apply`, `destroy` or other AWS write is run only after the owner approves that exact command** (CLAUDE.md).

## Layout

| Root | State | Contents |
|---|---|---|
| `infrastructure/bootstrap-state/` | `s3://<state bucket>/bootstrap/terraform.tfstate` (after migration) | The state bucket itself |
| `infrastructure/environments/control-plane-dev/` | `s3://<state bucket>/control-plane-dev/terraform.tfstate` | Cognito, HTTP API, Lambda, DynamoDB, logs, budget, GitHub OIDC plan role |
| `infrastructure/environments/disposable-labs/` | (Phase 4) | EC2/Nginx lab |

Locking uses the S3 lockfile (`use_lockfile = true`), never DynamoDB. The bucket name contains the account ID, so it lives only in the gitignored `backend.hcl` and `terraform.tfvars`.

## Prerequisites

- Terraform ≥ 1.10 (1.17 used), AWS CLI v2, Python 3.12 (`py -3.12`).
- AWS credentials for the Opsentra account (`aws login` or SSO), default region `ap-southeast-1`. Check with `aws sts get-caller-identity`.
- Billing → Credits checked (balance, expiry, eligible services) and the free/paid plan confirmed (§11).

## 1. Bootstrap the state bucket (once)

```bash
cd infrastructure/bootstrap-state
cp terraform.tfvars.example terraform.tfvars   # set account_id
terraform init
terraform plan -out=bootstrap.tfplan           # review
terraform apply bootstrap.tfplan               # owner approval required
terraform output state_bucket
```

Then move the bootstrap state into the bucket. Uncomment `backend "s3" {}` in `versions.tf` and run:

```bash
terraform init -migrate-state \
  -backend-config="bucket=<state bucket>" \
  -backend-config="key=bootstrap/terraform.tfstate" \
  -backend-config="region=ap-southeast-1" \
  -backend-config="use_lockfile=true"
```

Delete the local `terraform.tfstate*` only after `terraform plan` against the remote state shows no changes.

## 2. Control plane

```bash
cd infrastructure/environments/control-plane-dev
cp backend.hcl.example backend.hcl             # bucket from step 1
cp terraform.tfvars.example terraform.tfvars   # account_id, state_bucket
terraform init -backend-config=backend.hcl
terraform plan -out=cp.tfplan                  # review every resource
terraform apply cp.tfplan                      # owner approval required
terraform output                               # public IDs only
```

If you enable the optional budget (`create_budget = true`), confirm its alert subscription email.

## 3. Test users (Cognito)

```bash
export OPSENTRA_USER_POOL_ID=$(terraform output -raw user_pool_id)
export OPSENTRA_TEST_PASSWORD='<at least 14 chars, mixed case, digit, symbol>'
scripts/bootstrap/create-test-user.sh opsentra-viewer viewer
scripts/bootstrap/create-test-user.sh opsentra-operator operator
scripts/bootstrap/create-test-user.sh opsentra-admin admin
```

The password is passed on the AWS CLI command line, so it is briefly visible to local processes. Use test-only passwords.

## 4. Live checks

`aws login` credentials need the `botocore[crt]` extra (in `requirements-dev.txt`). Keep the settings in the gitignored `services/api/.env.test` and load them with `set -a; . ./.env.test; set +a`.


```bash
cd services/api
export OPSENTRA_API_URL=$(terraform -chdir=../../infrastructure/environments/control-plane-dev output -raw api_url)
export OPSENTRA_TEST_CLIENT_ID=...   # output integration_client_id
export OPSENTRA_TEST_VIEWER_USER=opsentra-viewer OPSENTRA_TEST_VIEWER_PASSWORD=...
# …operator and admin likewise
.venv/Scripts/python -m pytest tests/integration -v
```

## 5. Disposable lab (Phase 4)

The lab needs the control plane. Every lab apply and destroy needs the owner's approval.

```bash
cd infrastructure/environments/disposable-labs
cp backend.hcl.example backend.hcl            # same bucket, key disposable-labs/terraform.tfstate
cp terraform.tfvars.example terraform.tfvars  # account_id, state_bucket
terraform init -backend-config=backend.hcl
EXP=$(date -u -d '+4 hours' +%Y-%m-%dT%H:%M:%SZ)   # at most 12 hours ahead
terraform plan -var "lab_expires_at=$EXP" -out=lab.tfplan
terraform apply lab.tfplan                          # owner approval required
```

Gate test (each command needs approval):

```bash
ID=$(terraform output -raw instance_id)
MSYS_NO_PATHCONV=1 aws ssm send-command --document-name Opsentra-Lab-StopNginx --instance-ids "$ID"
# wait about 3–4 minutes, then:
aws cloudwatch describe-alarms --alarm-names opsentra-lab-nginx-availability --query "MetricAlarms[0].StateValue"
MSYS_NO_PATHCONV=1 aws ssm send-command --document-name Opsentra-Lab-RestartNginx --instance-ids "$ID"
```

Tear down when done (approval required):

```bash
terraform plan -destroy -var "lab_expires_at=$EXP" -out=lab-destroy.tfplan
terraform apply lab-destroy.tfplan
```

Then verify nothing billable is left (read-only):

```bash
aws ec2 describe-instances --filters Name=tag:opsentra:lab,Values=true Name=instance-state-name,Values=pending,running,stopping,stopped --query "length(Reservations)"
aws ec2 describe-volumes --filters Name=tag:opsentra:lab,Values=true --query "length(Volumes)"
aws ec2 describe-addresses --query "length(Addresses)"
aws ec2 describe-vpcs --filters Name=tag:opsentra:lab,Values=true --query "length(Vpcs)"
aws cloudwatch describe-alarms --alarm-name-prefix opsentra-lab- --query "length(MetricAlarms)"
aws scheduler list-schedules --name-prefix opsentra-lab --query "length(Schedules)"
aws logs describe-log-groups --log-group-name-prefix /aws/lambda/opsentra-lab --query "length(logGroups)"
aws ssm list-documents --filters Key=Owner,Values=Self Key=Name,Values=Opsentra-Lab --query "length(DocumentIdentifiers)"
```

On Git Bash, set `MSYS_NO_PATHCONV=1` for AWS CLI arguments that start with `/`.

## 6. Incidents (Phase 5)

- **Alert email:** set `alert_email` in the control-plane `terraform.tfvars` (gitignored). After the apply, AWS sends a "Subscription Confirmation" email; click the link or no alerts are delivered.
- **Dead-letter queue:** events that fail ingest after retries land in `opsentra-dev-incident-ingest-dlq`. Inspect without removing them:
  `aws sqs receive-message --queue-url $(aws sqs get-queue-url --queue-name opsentra-dev-incident-ingest-dlq --query QueueUrl --output text) --visibility-timeout 0`
  The reconciler repairs missed ALARM and OK events within 5 minutes, so a DLQ entry is evidence to read, not something to replay by hand.
- **Ingest test events** (gate test only, approval required): `aws lambda invoke --function-name opsentra-dev-incident-ingest --payload fileb://event.json out.json`.

## 7. Remediation (Phase 6)

- **Flow:** Operator requests "Restart Nginx" in the UI, an Administrator approves (the same admin may do both; it is shown as self-approved), the coordinator runs `Opsentra-Lab-RestartNginx` once, and the incident resolves only after 3 consecutive healthy probes.
- **Status of a run:** `GET /v1/remediations/{requestId}` (or the Recovery Center). Raw SSM detail, read-only:
  `aws ssm list-commands --filters key=DocumentName,value=Opsentra-Lab-RestartNginx --query "Commands[].[CommandId,Status,RequestedDateTime]"`
- **Escalated incident:** do not retry blindly (§12). Read the timeline (`REMEDIATION_FAILED`, `VERIFICATION_FAILED`), check the probe and the SSM output, then request again from the UI if a restart is still the right fix.
- **Coordinator DLQ:** `opsentra-dev-remediation-coordinator-dlq`. The reconciler already fails or dispatches stuck requests, so treat DLQ messages as evidence, not as work to replay.
- **Runbook changed?** The registry pins the document hash. After changing the SSM document, re-apply the lab so the registry gets the new hash; until then SSM refuses the old hash and the request fails safely.

## 8. Teardown (control plane)

```bash
cd infrastructure/environments/control-plane-dev
terraform plan -destroy -out=destroy.tfplan    # review
terraform apply destroy.tfplan                 # owner approval required
```

Then verify nothing is left (read-only):

```bash
aws dynamodb list-tables --query "TableNames[?starts_with(@,'opsentra-')]"
aws lambda list-functions --query "Functions[?starts_with(FunctionName,'opsentra-')].FunctionName"
aws apigatewayv2 get-apis --query "Items[?starts_with(Name,'opsentra-')].Name"
aws cognito-idp list-user-pools --max-results 20 --query "UserPools[?starts_with(Name,'opsentra-')].Name"
aws logs describe-log-groups --log-group-name-prefix /aws/lambda/opsentra- --query "logGroups[].logGroupName"
aws resourcegroupstaggingapi get-resources --tag-filters Key=opsentra:project,Values=opsentra --query "ResourceTagMappingList[].ResourceARN"
```

The state bucket has `prevent_destroy`. Destroy it only after every other root has been destroyed, and only on purpose.

## State recovery

- **Bad or corrupted state:** the bucket is versioned. List versions with `aws s3api list-object-versions --bucket <bucket> --prefix control-plane-dev/`, copy the last good version over the current object, then run `terraform plan` to confirm.
- **Stuck lock:** a crashed run leaves `<key>.tflock` in the bucket. Make sure nothing else is running, then `terraform force-unlock <lock id>`.
- **Lost local files:** everything except `terraform.tfvars` and `backend.hcl` is in Git, and both can be rebuilt from `*.example` and the bucket name.
- Old state versions expire after 90 days.

## Never

- Run `apply`, `destroy` or `import` without the owner's approval of that exact command.
- Commit `*.tfstate*`, `terraform.tfvars`, `backend.hcl` or `.terraform/`.
- Use DynamoDB state locking.
- Touch another region or account (`allowed_account_ids` and the region validation refuse it).
