import { describe, it, expect } from 'vitest'
import { App, Stack } from 'aws-cdk-lib'
import { Template, Match } from 'aws-cdk-lib/assertions'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as kms from 'aws-cdk-lib/aws-kms'
import * as cdk from 'aws-cdk-lib'
import * as path from 'path'
import { DynamoDbAuditLogging } from '../lib'

const HANDLER_PATH = path.join(__dirname, 'fixtures', 'handler')

function createStack(): Stack {
    const app = new App()
    return new Stack(app, 'TestStack', {
        env: { account: '123456789012', region: 'us-east-1' },
    })
}

function createTableWithStream(stack: Stack, id: string = 'Table'): dynamodb.Table {
    return new dynamodb.Table(stack, id, {
        partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
        stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
    })
}

describe('S3 Audit Bucket Configuration', () => {
    describe('default encryption and security', () => {
        it('should create bucket with S3-managed encryption by default', () => {
            const stack = createStack()
            const table = createTableWithStream(stack)

            new DynamoDbAuditLogging(stack, 'Audit', {
                sourceTable: table,
                lambdaCodePath: HANDLER_PATH,
                enableCrawler: false,
            })

            const template = Template.fromStack(stack)
            template.hasResourceProperties('AWS::S3::Bucket', {
                BucketEncryption: {
                    ServerSideEncryptionConfiguration: [
                        {
                            ServerSideEncryptionByDefault: {
                                SSEAlgorithm: 'AES256',
                            },
                        },
                    ],
                },
            })
        })

        it('should block all public access', () => {
            const stack = createStack()
            const table = createTableWithStream(stack)

            new DynamoDbAuditLogging(stack, 'Audit', {
                sourceTable: table,
                lambdaCodePath: HANDLER_PATH,
                enableCrawler: false,
            })

            const template = Template.fromStack(stack)
            template.hasResourceProperties('AWS::S3::Bucket', {
                PublicAccessBlockConfiguration: {
                    BlockPublicAcls: true,
                    BlockPublicPolicy: true,
                    IgnorePublicAcls: true,
                    RestrictPublicBuckets: true,
                },
            })
        })

        it('should enforce SSL via bucket policy', () => {
            const stack = createStack()
            const table = createTableWithStream(stack)

            new DynamoDbAuditLogging(stack, 'Audit', {
                sourceTable: table,
                lambdaCodePath: HANDLER_PATH,
                enableCrawler: false,
            })

            const template = Template.fromStack(stack)
            template.hasResourceProperties('AWS::S3::BucketPolicy', {
                PolicyDocument: {
                    Statement: Match.arrayWith([
                        Match.objectLike({
                            Effect: 'Deny',
                            Condition: {
                                Bool: { 'aws:SecureTransport': 'false' },
                            },
                        }),
                    ]),
                },
            })
        })
    })

    describe('KMS encryption', () => {
        it('should use KMS encryption when encryptionKey is provided', () => {
            const stack = createStack()
            const table = createTableWithStream(stack)
            const key = new kms.Key(stack, 'AuditKey')

            new DynamoDbAuditLogging(stack, 'Audit', {
                sourceTable: table,
                lambdaCodePath: HANDLER_PATH,
                encryptionKey: key,
                enableCrawler: false,
            })

            const template = Template.fromStack(stack)
            template.hasResourceProperties('AWS::S3::Bucket', {
                BucketEncryption: {
                    ServerSideEncryptionConfiguration: [
                        {
                            ServerSideEncryptionByDefault: {
                                SSEAlgorithm: 'aws:kms',
                                KMSMasterKeyID: Match.anyValue(),
                            },
                        },
                    ],
                },
            })
        })
    })

    describe('existing audit bucket', () => {
        it('should not create a new bucket when existingAuditBucket is provided', () => {
            const stack = createStack()
            const table = createTableWithStream(stack)
            const existingBucket = s3.Bucket.fromBucketName(stack, 'ExistingBucket', 'my-existing-bucket')

            new DynamoDbAuditLogging(stack, 'Audit', {
                sourceTable: table,
                lambdaCodePath: HANDLER_PATH,
                existingAuditBucket: existingBucket,
                enableCrawler: false,
            })

            const template = Template.fromStack(stack)
            template.resourceCountIs('AWS::S3::Bucket', 0)
        })
    })

    describe('lifecycle rules', () => {
        it('should apply lifecycle rules when provided', () => {
            const stack = createStack()
            const table = createTableWithStream(stack)

            new DynamoDbAuditLogging(stack, 'Audit', {
                sourceTable: table,
                lambdaCodePath: HANDLER_PATH,
                enableCrawler: false,
                s3LifecycleRules: [
                    {
                        expiration: cdk.Duration.days(90),
                    },
                    {
                        transitions: [
                            {
                                storageClass: s3.StorageClass.GLACIER,
                                transitionAfter: cdk.Duration.days(30),
                            },
                        ],
                    },
                ],
            })

            const template = Template.fromStack(stack)
            template.hasResourceProperties('AWS::S3::Bucket', {
                LifecycleConfiguration: {
                    Rules: Match.arrayWith([
                        Match.objectLike({
                            ExpirationInDays: 90,
                            Status: 'Enabled',
                        }),
                        Match.objectLike({
                            Transitions: Match.arrayWith([
                                Match.objectLike({
                                    StorageClass: 'GLACIER',
                                    TransitionInDays: 30,
                                }),
                            ]),
                            Status: 'Enabled',
                        }),
                    ]),
                },
            })
        })
    })

    describe('versioning', () => {
        it('should enable versioning by default', () => {
            const stack = createStack()
            const table = createTableWithStream(stack)

            new DynamoDbAuditLogging(stack, 'Audit', {
                sourceTable: table,
                lambdaCodePath: HANDLER_PATH,
                enableCrawler: false,
            })

            const template = Template.fromStack(stack)
            template.hasResourceProperties('AWS::S3::Bucket', {
                VersioningConfiguration: { Status: 'Enabled' },
            })
        })

        it('should disable versioning when bucketVersioned is false', () => {
            const stack = createStack()
            const table = createTableWithStream(stack)

            new DynamoDbAuditLogging(stack, 'Audit', {
                sourceTable: table,
                lambdaCodePath: HANDLER_PATH,
                enableCrawler: false,
                bucketVersioned: false,
            })

            const template = Template.fromStack(stack)
            template.hasResourceProperties('AWS::S3::Bucket', {
                VersioningConfiguration: Match.absent(),
            })
        })

        it('should reject bucketVersioned alongside existingAuditBucket', () => {
            const stack = createStack()
            const table = createTableWithStream(stack)
            const existingBucket = s3.Bucket.fromBucketName(stack, 'ExistingBucket', 'my-existing-bucket')

            expect(() => new DynamoDbAuditLogging(stack, 'Audit', {
                sourceTable: table,
                lambdaCodePath: HANDLER_PATH,
                existingAuditBucket: existingBucket,
                bucketVersioned: true,
                enableCrawler: false,
            })).toThrow(/bucketVersioned/)
        })
    })

    describe('server access logs', () => {
        it('should not configure access logging by default', () => {
            const stack = createStack()
            const table = createTableWithStream(stack)

            new DynamoDbAuditLogging(stack, 'Audit', {
                sourceTable: table,
                lambdaCodePath: HANDLER_PATH,
                enableCrawler: false,
            })

            const template = Template.fromStack(stack)
            template.hasResourceProperties('AWS::S3::Bucket', {
                LoggingConfiguration: Match.absent(),
            })
        })

        it('should wire access logging to the supplied target bucket', () => {
            const stack = createStack()
            const table = createTableWithStream(stack)
            const logsBucket = new s3.Bucket(stack, 'AccessLogsBucket')

            new DynamoDbAuditLogging(stack, 'Audit', {
                sourceTable: table,
                lambdaCodePath: HANDLER_PATH,
                enableCrawler: false,
                serverAccessLogs: {
                    bucket: logsBucket,
                    prefix: 'audit-bucket-access/',
                },
            })

            const template = Template.fromStack(stack)
            template.hasResourceProperties('AWS::S3::Bucket', {
                LoggingConfiguration: {
                    DestinationBucketName: Match.anyValue(),
                    LogFilePrefix: 'audit-bucket-access/',
                },
            })
        })

        it('should reject serverAccessLogs alongside existingAuditBucket', () => {
            const stack = createStack()
            const table = createTableWithStream(stack)
            const existingBucket = s3.Bucket.fromBucketName(stack, 'ExistingBucket', 'my-existing-bucket')
            const logsBucket = new s3.Bucket(stack, 'AccessLogsBucket')

            expect(() => new DynamoDbAuditLogging(stack, 'Audit', {
                sourceTable: table,
                lambdaCodePath: HANDLER_PATH,
                existingAuditBucket: existingBucket,
                serverAccessLogs: { bucket: logsBucket },
                enableCrawler: false,
            })).toThrow(/serverAccessLogs/)
        })
    })
})
