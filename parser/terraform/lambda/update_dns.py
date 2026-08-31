import os

import boto3

ec2 = boto3.client("ec2")
route53 = boto3.client("route53")

HOSTED_ZONE_ID = os.environ["HOSTED_ZONE_ID"]
RECORD_NAME = os.environ["RECORD_NAME"]


def handler(event, context):
    detail = event["detail"]
    if detail.get("lastStatus") != "RUNNING":
        return {"skipped": detail.get("lastStatus")}

    eni_id = next(
        (
            d["value"]
            for a in detail.get("attachments", [])
            for d in a.get("details", [])
            if d["name"] == "networkInterfaceId"
        ),
        None,
    )
    if not eni_id:
        return {"skipped": "no eni in event"}

    eni = ec2.describe_network_interfaces(NetworkInterfaceIds=[eni_id])
    public_ip = eni["NetworkInterfaces"][0].get("Association", {}).get("PublicIp")
    if not public_ip:
        return {"skipped": "no public ip assigned yet"}

    route53.change_resource_record_sets(
        HostedZoneId=HOSTED_ZONE_ID,
        ChangeBatch={
            "Changes": [
                {
                    "Action": "UPSERT",
                    "ResourceRecordSet": {
                        "Name": RECORD_NAME,
                        "Type": "A",
                        "TTL": 60,
                        "ResourceRecords": [{"Value": public_ip}],
                    },
                }
            ]
        },
    )
    return {"updated": public_ip}
