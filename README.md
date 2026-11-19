## My Project
The construct owns all infrastructure. You own the Lambda handler logic — provide a code path, the construct wires everything else.

## Flow Diagram

The numbered steps in the architecture diagram:

1. **Step 1 — DynamoDB Streams** — every insert, modify, and remove on the source table emits a change record that triggers the Lambda stream processor.
2. **Step 2 — PutObject to Amazon S3** — the Lambda writes each audit event as a JSONL object into the S3 audit bucket under Hive-style `year=/month=/day=/hour=` partitions.
3. **Step 3 — Crawl partitions with Glue Crawler** — on a schedule, the Glue Crawler scans the partitioned S3 prefix.
4. **Step 4 — Schema discovery** — the crawler infers the schema and registers the table and partitions in the Glue Data Catalog.
5. **Step 5 — Query audit data with Athena** — run SQL against the cataloged table, using partition pruning to keep scans fast and cheap.
6. **Step 6 — Failed records to SQS** — stream records that exhaust Lambda retries are sent to the SQS dead-letter queue for later inspection.

Be sure to:

* Change the title in this README
* Edit your repository description on GitHub

## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This library is licensed under the MIT-0 License. See the LICENSE file.

