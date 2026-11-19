const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3')

const s3 = new S3Client({})
const BUCKET = process.env.AUDIT_BUCKET_NAME
const KEY_PREFIX = process.env.S3_KEY_PREFIX || 'audit-data'

exports.handler = async (event, context) => {
    const records = []

    for (const record of event.Records) {
        const auditRecord = {
            eventType: record.eventName,
            eventID: record.eventID,
            timestamp: new Date().toISOString(),
            newImage: record.dynamodb.NewImage || null,
            oldImage: record.dynamodb.OldImage || null,
            keys: record.dynamodb.Keys,
        }
        records.push(JSON.stringify(auditRecord))
    }

    if (records.length === 0) return { statusCode: 200 }

    const now = new Date()
    const year = now.getUTCFullYear()
    const month = String(now.getUTCMonth() + 1).padStart(2, '0')
    const day = String(now.getUTCDate()).padStart(2, '0')
    const hour = String(now.getUTCHours()).padStart(2, '0')

    const key = `${KEY_PREFIX}/year=${year}/month=${month}/day=${day}/hour=${hour}/${context.awsRequestId}.jsonl`

    await s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: records.join('\n'),
        ContentType: 'application/jsonl',
    }))

    console.log(`Wrote ${records.length} audit records to s3://${BUCKET}/${key}`)
    return { statusCode: 200, recordsProcessed: records.length }
}
