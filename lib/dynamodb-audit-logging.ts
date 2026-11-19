import { Construct } from 'constructs'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as glue from 'aws-cdk-lib/aws-glue'
import * as logs from 'aws-cdk-lib/aws-logs'
import { DynamoEventSource, SqsDlq } from 'aws-cdk-lib/aws-lambda-event-sources'
import { Aws, Duration, RemovalPolicy, Tags } from 'aws-cdk-lib'
import { NagSuppressions } from 'cdk-nag'
import { DynamoDbAuditLoggingProps } from './dynamodb-audit-logging-props'

export class DynamoDbAuditLogging extends Construct {
    public readonly auditBucket: s3.IBucket
    public readonly streamProcessor: lambda.Function
    public readonly streamProcessorRole: iam.Role
    public readonly auditDatabase?: glue.CfnDatabase
    public readonly auditCrawler?: glue.CfnCrawler
    public readonly crawlerRole?: iam.Role

    constructor(scope: Construct, id: string, props: DynamoDbAuditLoggingProps) {
        super(scope, id)

        // 1. Validate props
        if (!props.sourceTable.tableStreamArn) {
            throw new Error('sourceTable must have DynamoDB Streams enabled (NEW_AND_OLD_IMAGES recommended)')
        }

        if (props.existingAuditBucket && props.encryptionKey) {
            throw new Error('Cannot specify encryptionKey when using existingAuditBucket — encryption is managed by the existing bucket')
        }

        if (props.existingAuditBucket && props.s3LifecycleRules) {
            throw new Error('Cannot specify s3LifecycleRules when using existingAuditBucket — lifecycle is managed externally')
        }

        if (props.existingAuditBucket && props.bucketVersioned !== undefined) {
            throw new Error('Cannot specify bucketVersioned when using existingAuditBucket — versioning is managed by the existing bucket')
        }

        if (props.existingAuditBucket && props.serverAccessLogs) {
            throw new Error('Cannot specify serverAccessLogs when using existingAuditBucket — access logging is managed by the existing bucket')
        }

        if (props.streamBatchSize !== undefined && (props.streamBatchSize < 1 || props.streamBatchSize > 10000)) {
            throw new Error('streamBatchSize must be between 1 and 10000')
        }

        if (props.streamParallelizationFactor !== undefined && (props.streamParallelizationFactor < 1 || props.streamParallelizationFactor > 10)) {
            throw new Error('streamParallelizationFactor must be between 1 and 10')
        }

        // 2. Create or use S3 bucket
        const prefix = props.prefix ?? id.toLowerCase().replace(/[^a-z0-9-]/g, '-')
        const stage = props.stage ?? 'dev'

        if (props.existingAuditBucket) {
            this.auditBucket = props.existingAuditBucket
        } else {
            const bucketName = `${prefix}-audit-${stage}-${Aws.ACCOUNT_ID}`

            const bucket = new s3.Bucket(this, 'AuditBucket', {
                bucketName,
                encryption: props.encryptionKey
                    ? s3.BucketEncryption.KMS
                    : s3.BucketEncryption.S3_MANAGED,
                encryptionKey: props.encryptionKey,
                blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
                enforceSSL: true,
                versioned: props.bucketVersioned ?? true,
                removalPolicy: props.bucketRemovalPolicy ?? RemovalPolicy.RETAIN,
                lifecycleRules: props.s3LifecycleRules,
                ...(props.serverAccessLogs && {
                    serverAccessLogsBucket: props.serverAccessLogs.bucket,
                    serverAccessLogsPrefix: props.serverAccessLogs.prefix,
                }),
            })

            this.auditBucket = bucket
        }

        // 3. Create Lambda execution role (least-privilege)
        const functionName = `${prefix}-audit-stream-processor-${stage}`
        const logGroupName = `/aws/lambda/${functionName}`

        this.streamProcessorRole = new iam.Role(this, 'StreamProcessorRole', {
            roleName: `${prefix}-audit-stream-processor-role-${stage}`,
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            inlinePolicies: {
                StreamProcessorPolicy: new iam.PolicyDocument({
                    statements: [
                        new iam.PolicyStatement({
                            effect: iam.Effect.ALLOW,
                            actions: [
                                'logs:CreateLogGroup',
                                'logs:CreateLogStream',
                                'logs:PutLogEvents',
                            ],
                            resources: [
                                `arn:${Aws.PARTITION}:logs:${Aws.REGION}:${Aws.ACCOUNT_ID}:log-group:${logGroupName}:*`,
                            ],
                        }),
                        new iam.PolicyStatement({
                            effect: iam.Effect.ALLOW,
                            actions: [
                                's3:PutObject',
                                's3:GetObject',
                            ],
                            resources: [`${this.auditBucket.bucketArn}/*`],
                        }),
                        new iam.PolicyStatement({
                            effect: iam.Effect.ALLOW,
                            actions: ['s3:ListBucket'],
                            resources: [this.auditBucket.bucketArn],
                        }),
                    ],
                }),
            },
        })

        // 4. Create Lambda function + event source mapping
        const logGroup = new logs.LogGroup(this, 'StreamProcessorLogGroup', {
            logGroupName,
            retention: props.lambdaLogRetention ?? logs.RetentionDays.ONE_MONTH,
        })

        const s3KeyPrefix = props.s3KeyPrefix ?? 'audit-data'

        const lambdaEnvironment: Record<string, string> = {
            AUDIT_BUCKET_NAME: this.auditBucket.bucketName,
            S3_KEY_PREFIX: s3KeyPrefix,
            ...props.lambdaEnvironment,
        }

        this.streamProcessor = new lambda.Function(this, 'StreamProcessor', {
            functionName,
            code: lambda.Code.fromAsset(props.lambdaCodePath),
            handler: props.lambdaHandler ?? 'index.handler',
            runtime: props.lambdaRuntime ?? lambda.Runtime.NODEJS_22_X,
            timeout: props.lambdaTimeout ?? Duration.minutes(5),
            memorySize: props.lambdaMemorySize ?? 128,
            environment: lambdaEnvironment,
            role: this.streamProcessorRole,
            logGroup,
            layers: props.lambdaLayers,
            reservedConcurrentExecutions: props.lambdaReservedConcurrency,
            ...(props.lambdaVpcConfig && {
                vpc: props.lambdaVpcConfig.vpc,
                securityGroups: props.lambdaVpcConfig.securityGroups,
                vpcSubnets: props.lambdaVpcConfig.subnetSelection,
            }),
        })

        const eventSource = new DynamoEventSource(props.sourceTable, {
            startingPosition: props.streamStartingPosition ?? lambda.StartingPosition.LATEST,
            batchSize: props.streamBatchSize ?? 25,
            retryAttempts: props.streamRetryAttempts ?? 3,
            parallelizationFactor: props.streamParallelizationFactor ?? 2,
            maxRecordAge: props.streamMaximumRecordAge,
            bisectBatchOnError: props.streamBisectBatchOnError ?? false,
            ...(props.streamFilterCriteria && {
                filters: props.streamFilterCriteria as unknown as Array<{ [key: string]: any }>,
            }),
            ...(props.deadLetterQueue && {
                onFailure: new SqsDlq(props.deadLetterQueue),
            }),
        })

        this.streamProcessor.addEventSource(eventSource)

        // 5. Conditionally create Glue DB, Crawler, Crawler role
        const enableCrawler = props.enableCrawler ?? true

        if (enableCrawler) {
            const crawlerSchedule = props.crawlerSchedule ?? 'cron(0 */6 * * ? *)'
            const crawlerTablePrefix = props.crawlerTablePrefix ?? 'audit_'
            const dbName = `${prefix}_audit_db_${stage}`.replace(/-/g, '_')

            const database = new glue.CfnDatabase(this, 'AuditDatabase', {
                catalogId: Aws.ACCOUNT_ID,
                databaseInput: {
                    name: dbName,
                },
            })

            this.auditDatabase = database

            this.crawlerRole = new iam.Role(this, 'CrawlerRole', {
                roleName: `${prefix}-audit-crawler-role-${stage}`,
                assumedBy: new iam.ServicePrincipal('glue.amazonaws.com'),
                managedPolicies: [
                    iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSGlueServiceRole'),
                ],
                inlinePolicies: {
                    CrawlerBucketReadPolicy: new iam.PolicyDocument({
                        statements: [
                            new iam.PolicyStatement({
                                effect: iam.Effect.ALLOW,
                                actions: ['s3:GetObject'],
                                resources: [`${this.auditBucket.bucketArn}/${s3KeyPrefix}/*`],
                            }),
                            new iam.PolicyStatement({
                                effect: iam.Effect.ALLOW,
                                actions: ['s3:ListBucket'],
                                resources: [this.auditBucket.bucketArn],
                            }),
                        ],
                    }),
                },
            })

            const crawler = new glue.CfnCrawler(this, 'AuditCrawler', {
                name: `${prefix}-audit-crawler-${stage}`,
                role: this.crawlerRole.roleArn,
                databaseName: dbName,
                schedule: {
                    scheduleExpression: crawlerSchedule,
                },
                targets: {
                    s3Targets: [{
                        path: `s3://${this.auditBucket.bucketName}/${s3KeyPrefix}/`,
                    }],
                },
                schemaChangePolicy: {
                    deleteBehavior: 'LOG',
                    updateBehavior: 'UPDATE_IN_DATABASE',
                },
                tablePrefix: crawlerTablePrefix,
                recrawlPolicy: {
                    recrawlBehavior: 'CRAWL_EVERYTHING',
                },
            })

            crawler.addDependency(database)

            this.auditCrawler = crawler
        }
        // 6. Apply CDK Nag suppressions
        if (!props.existingAuditBucket && !props.serverAccessLogs) {
            NagSuppressions.addResourceSuppressions(this.auditBucket as s3.Bucket, [
                {
                    id: 'AwsSolutions-S1',
                    reason: 'Server access logging is opt-in via the serverAccessLogs prop; consumers can enable it by supplying a target bucket',
                },
            ])
        }

        NagSuppressions.addResourceSuppressions(this.streamProcessorRole, [
            {
                id: 'AwsSolutions-IAM5',
                reason: 'CloudWatch Logs wildcard required for log stream names under the log group; S3 object wildcard required for Hive-partitioned writes to dynamic keys',
            },
        ])

        if (enableCrawler && this.crawlerRole) {
            NagSuppressions.addResourceSuppressions(this.crawlerRole, [
                {
                    id: 'AwsSolutions-IAM4',
                    reason: 'AWSGlueServiceRole is AWS-recommended for Glue Crawlers',
                },
                {
                    id: 'AwsSolutions-IAM5',
                    reason: 'S3 read wildcards required for Glue Crawler partition discovery',
                },
            ])
        }
        // 7. Apply tags
        Tags.of(this).add('audit:managed-by', 'DynamoDbAuditLogging')

        if (props.tags) {
            for (const [key, value] of Object.entries(props.tags)) {
                Tags.of(this).add(key, value)
            }
        }
    }
}
