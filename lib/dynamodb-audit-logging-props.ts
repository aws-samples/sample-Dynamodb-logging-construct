import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as kms from 'aws-cdk-lib/aws-kms'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as sqs from 'aws-cdk-lib/aws-sqs'
import * as logs from 'aws-cdk-lib/aws-logs'
import { Duration, RemovalPolicy } from 'aws-cdk-lib'

export interface DynamoDbAuditLoggingProps {
    // Required
    readonly sourceTable: dynamodb.ITable
    readonly lambdaCodePath: string

    // Lambda config
    readonly lambdaHandler?: string
    readonly lambdaRuntime?: lambda.Runtime
    readonly lambdaTimeout?: Duration
    readonly lambdaMemorySize?: number
    readonly lambdaEnvironment?: Record<string, string>
    readonly lambdaLayers?: lambda.LayerVersion[]
    readonly lambdaReservedConcurrency?: number
    readonly lambdaLogRetention?: logs.RetentionDays
    readonly lambdaVpcConfig?: {
        vpc: ec2.IVpc
        securityGroups: ec2.ISecurityGroup[]
        subnetSelection?: ec2.SubnetSelection
    }

    // Stream config
    readonly streamStartingPosition?: lambda.StartingPosition
    readonly streamBatchSize?: number
    readonly streamRetryAttempts?: number
    readonly streamParallelizationFactor?: number
    readonly streamFilterCriteria?: lambda.FilterCriteria
    readonly streamMaximumRecordAge?: Duration
    readonly streamBisectBatchOnError?: boolean
    readonly deadLetterQueue?: sqs.IQueue

    // S3 config
    readonly existingAuditBucket?: s3.IBucket
    readonly encryptionKey?: kms.IKey
    readonly bucketRemovalPolicy?: RemovalPolicy
    readonly s3KeyPrefix?: string
    readonly s3LifecycleRules?: s3.LifecycleRule[]
    /**
     * Enable S3 versioning on the audit bucket. Defaults to true. Audit data
     * is append-only, so versioning provides cheap protection against
     * accidental deletion or object overwrites. Ignored when
     * `existingAuditBucket` is provided.
     */
    readonly bucketVersioned?: boolean
    /**
     * Send S3 server access logs from the audit bucket to a separate target
     * bucket. The target bucket must be supplied by the caller (audit logs
     * cannot safely be written into the bucket they describe). Ignored when
     * `existingAuditBucket` is provided.
     */
    readonly serverAccessLogs?: {
        readonly bucket: s3.IBucket
        readonly prefix?: string
    }

    // Glue config
    readonly enableCrawler?: boolean
    readonly crawlerSchedule?: string
    readonly crawlerTablePrefix?: string

    // Naming/tagging
    readonly prefix?: string
    readonly stage?: string
    readonly tags?: Record<string, string>
}
