"""Read-only check that the disposable lab is fully gone (CLAUDE.md teardown list).

Usage: services/api/.venv/Scripts/python.exe scripts/gate/verify_teardown.py
Exit code 0 when nothing is left, 1 otherwise. Only describe/list/get calls are
made, in ap-southeast-1 only. Account IDs are never printed.

Checks: EC2 instances, EBS volumes, public IPv4 / Elastic IPs, security groups
and VPCs tagged opsentra:lab=true; CloudWatch alarms and log groups named
opsentra-lab-*; the probe schedule; lab registry items; active lab runs.
"""

from __future__ import annotations

import re
import sys

import boto3

REGION = "ap-southeast-1"
LAB_TAG = [{"Name": "tag:opsentra:lab", "Values": ["true"]}]
PREFIX = "opsentra-lab-"
ACCOUNT = re.compile(r"\d{12}")


def mask(text: str) -> str:
    return ACCOUNT.sub("<account>", text)


def main() -> int:
    ec2 = boto3.client("ec2", region_name=REGION)
    cw = boto3.client("cloudwatch", region_name=REGION)
    logs = boto3.client("logs", region_name=REGION)
    sched = boto3.client("scheduler", region_name=REGION)
    ddb = boto3.client("dynamodb", region_name=REGION)

    left: dict[str, list[str]] = {}

    def found(kind: str, ids: list[str]) -> None:
        left[kind] = ids
        print(
            f"{kind:<22} {len(ids)}"
            + (f"  {', '.join(mask(i) for i in ids)}" if ids else "")
        )

    live_states = ["pending", "running", "shutting-down", "stopping", "stopped"]
    res = ec2.describe_instances(
        Filters=LAB_TAG + [{"Name": "instance-state-name", "Values": live_states}]
    )
    found(
        "EC2 instances",
        [i["InstanceId"] for r in res["Reservations"] for i in r["Instances"]],
    )
    found(
        "EBS volumes",
        [v["VolumeId"] for v in ec2.describe_volumes(Filters=LAB_TAG)["Volumes"]],
    )
    found(
        "Elastic IPs",
        [
            a.get("AllocationId", a.get("PublicIp", "?"))
            for a in ec2.describe_addresses(Filters=LAB_TAG)["Addresses"]
        ],
    )
    enis = ec2.describe_network_interfaces(Filters=LAB_TAG)["NetworkInterfaces"]
    found(
        "Public IPv4 on ENIs",
        [
            n["NetworkInterfaceId"]
            for n in enis
            if n.get("Association", {}).get("PublicIp")
        ],
    )
    found(
        "Security groups",
        [
            g["GroupId"]
            for g in ec2.describe_security_groups(Filters=LAB_TAG)["SecurityGroups"]
        ],
    )
    found("VPCs", [v["VpcId"] for v in ec2.describe_vpcs(Filters=LAB_TAG)["Vpcs"]])

    alarms = cw.describe_alarms(AlarmNamePrefix=PREFIX)["MetricAlarms"]
    found("Alarms", [a["AlarmName"] for a in alarms])
    groups: list[str] = []
    for prefix in (f"/aws/lambda/{PREFIX}", f"/aws/events/{PREFIX}"):
        groups += [
            g["logGroupName"]
            for g in logs.describe_log_groups(logGroupNamePrefix=prefix)["logGroups"]
        ]
    found("Log groups", groups)
    schedules = sched.list_schedules(NamePrefix=PREFIX)["Schedules"]
    found("Probe schedules", [s["Name"] for s in schedules])

    tables = [t for t in ddb.list_tables()["TableNames"] if t.startswith("opsentra-")]
    resources = next((t for t in tables if t.endswith("-resources")), None)
    lab_runs = next((t for t in tables if t.endswith("-lab-runs")), None)
    if resources:
        items = ddb.scan(
            TableName=resources,
            FilterExpression="#e = :lab",
            ExpressionAttributeNames={"#e": "environment"},
            ExpressionAttributeValues={":lab": {"S": "lab"}},
        )["Items"]
        found("Registry items (lab)", [i["resourceId"]["S"] for i in items])
    if lab_runs:
        items = ddb.scan(
            TableName=lab_runs,
            FilterExpression="#s = :a",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={":a": {"S": "ACTIVE"}},
        )["Items"]
        found("Active lab runs", [i["runId"]["S"] for i in items])

    remaining = sum(len(v) for v in left.values())
    print(
        "TEARDOWN VERIFIED: nothing left"
        if remaining == 0
        else f"NOT CLEAN: {remaining} item(s) left"
    )
    return 0 if remaining == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
