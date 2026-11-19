import { Stack, StackProps, RemovalPolicy, CfnOutput } from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as s3 from 'aws-cdk-lib/aws-s3'
import { NagSuppressions } from 'cdk-nag'
import { DynamoDbAuditLogging } from '../../lib'

export class IntegTestStack extends Stack {
    constructor(scope: Construct, id: string, props?: StackProps) {
        super(scope, id, props)

        // Create a DynamoDB table with streams enabled
        const table = new dynamodb.Table(this, 'TestTable', {
            partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
            stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
            pointInTimeRecovery: true,
            removalPolicy: RemovalPolicy.DESTROY,
            tableName: 'audit-integ-test-table',
        })

        // Target bucket for S3 server access logs from the audit bucket.
        // Kept separate so the audit bucket never logs to itself.
        const accessLogsBucket = new s3.Bucket(this, 'AuditAccessLogsBucket', {
            encryption: s3.BucketEncryption.S3_MANAGED,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            enforceSSL: true,
            removalPolicy: RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
        })

        // The access-logs bucket itself doesn't need access logging — that
        // would be infinite regress. Suppress S1 on this bucket only.
        NagSuppressions.addResourceSuppressions(accessLogsBucket, [
            {
                id: 'AwsSolutions-S1',
                reason: 'This is the access-logs target bucket; logging it would create a recursion',
            },
        ])

        // Use the construct
        const auditLogging = new DynamoDbAuditLogging(this, 'AuditLogging', {
            sourceTable: table,
            lambdaCodePath: '../test/fixtures/handler',
            prefix: 'integ-test',
            stage: 'dev',
            enableCrawler: true,
            bucketRemovalPolicy: RemovalPolicy.DESTROY,
            serverAccessLogs: {
                bucket: accessLogsBucket,
                prefix: 'audit-bucket-access/',
            },
            tags: {
                'project': 'dynamodb-audit-logging-integ-test',
                'environment': 'dev',
            },
        })

        // Outputs for verification
        new CfnOutput(this, 'AuditBucketName', {
            value: auditLogging.auditBucket.bucketName,
            description: 'Audit S3 bucket name',
        })

        new CfnOutput(this, 'StreamProcessorArn', {
            value: auditLogging.streamProcessor.functionArn,
            description: 'Stream processor Lambda ARN',
        })

        new CfnOutput(this, 'StreamProcessorRoleArn', {
            value: auditLogging.streamProcessorRole.roleArn,
            description: 'Stream processor IAM role ARN',
        })

        if (auditLogging.auditDatabase) {
            new CfnOutput(this, 'GlueDatabaseName', {
                value: auditLogging.auditDatabase.ref,
                description: 'Glue database name',
            })
        }

        if (auditLogging.auditCrawler) {
            new CfnOutput(this, 'GlueCrawlerName', {
                value: auditLogging.auditCrawler.ref,
                description: 'Glue crawler name',
            })
        }
    }
}
