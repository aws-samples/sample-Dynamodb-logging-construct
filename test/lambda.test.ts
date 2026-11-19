import { describe, it, expect } from 'vitest'
import { App, Stack } from 'aws-cdk-lib'
import { Template, Match } from 'aws-cdk-lib/assertions'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
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

describe('Lambda Stream Processor', () => {
    describe('defaults', () => {
        it('should use index.handler as the default handler', () => {
            const stack = createStack()
            const table = createTableWithStream(stack)

            new DynamoDbAuditLogging(stack, 'Audit', {
                sourceTable: table,
                lambdaCodePath: HANDLER_PATH,
                enableCrawler: false,
            })

            const template = Template.fromStack(stack)
            template.hasResourceProperties('AWS::Lambda::Function', {
                Handler: 'index.handler',
            })
        })

        it('should use nodejs22.x as the default runtime', () => {
            const stack = createStack()
            const table = createTableWithStream(stack)

            new DynamoDbAuditLogging(stack, 'Audit', {
                sourceTable: table,
                lambdaCodePath: HANDLER_PATH,
                enableCrawler: false,
            })

            const template = Template.fromStack(stack)
            template.hasResourceProperties('AWS::Lambda::Function', {
                Runtime: 'nodejs22.x',
            })
        })

        it('should use 300 seconds (5 minutes) as the default timeout', () => {
            const stack = createStack()
            const table = createTableWithStream(stack)

            new DynamoDbAuditLogging(stack, 'Audit', {
                sourceTable: table,
                lambdaCodePath: HANDLER_PATH,
                enableCrawler: false,
            })

            const template = Template.fromStack(stack)
            template.hasResourceProperties('AWS::Lambda::Function', {
                Timeout: 300,
            })
        })

        it('should use 128 MB as the default memory size', () => {
            const stack = createStack()
            const table = createTableWithStream(stack)

            new DynamoDbAuditLogging(stack, 'Audit', {
                sourceTable: table,
                lambdaCodePath: HANDLER_PATH,
                enableCrawler: false,
            })

            const template = Template.fromStack(stack)
            template.hasResourceProperties('AWS::Lambda::Function', {
                MemorySize: 128,
            })
        })
    })

    describe('environment variables', () => {
        it('should inject AUDIT_BUCKET_NAME environment variable', () => {
            const stack = createStack()
            const table = createTableWithStream(stack)

            new DynamoDbAuditLogging(stack, 'Audit', {
                sourceTable: table,
                lambdaCodePath: HANDLER_PATH,
                enableCrawler: false,
            })

            const template = Template.fromStack(stack)
            template.hasResourceProperties('AWS::Lambda::Function', {
                Environment: {
                    Variables: Match.objectLike({
                        AUDIT_BUCKET_NAME: Match.anyValue(),
                    }),
                },
            })
        })

        it('should inject S3_KEY_PREFIX environment variable', () => {
            const stack = createStack()
            const table = createTableWithStream(stack)

            new DynamoDbAuditLogging(stack, 'Audit', {
                sourceTable: table,
                lambdaCodePath: HANDLER_PATH,
                enableCrawler: false,
            })

            const template = Template.fromStack(stack)
            template.hasResourceProperties('AWS::Lambda::Function', {
                Environment: {
                    Variables: Match.objectLike({
                        S3_KEY_PREFIX: 'audit-data',
                    }),
                },
            })
        })
    })

    describe('event source mapping', () => {
        it('should configure default batch size of 25', () => {
            const stack = createStack()
            const table = createTableWithStream(stack)

            new DynamoDbAuditLogging(stack, 'Audit', {
                sourceTable: table,
                lambdaCodePath: HANDLER_PATH,
                enableCrawler: false,
            })

            const template = Template.fromStack(stack)
            template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
                BatchSize: 25,
            })
        })

        it('should configure default retry attempts of 3', () => {
            const stack = createStack()
            const table = createTableWithStream(stack)

            new DynamoDbAuditLogging(stack, 'Audit', {
                sourceTable: table,
                lambdaCodePath: HANDLER_PATH,
                enableCrawler: false,
            })

            const template = Template.fromStack(stack)
            template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
                MaximumRetryAttempts: 3,
            })
        })

        it('should configure default parallelization factor of 2', () => {
            const stack = createStack()
            const table = createTableWithStream(stack)

            new DynamoDbAuditLogging(stack, 'Audit', {
                sourceTable: table,
                lambdaCodePath: HANDLER_PATH,
                enableCrawler: false,
            })

            const template = Template.fromStack(stack)
            template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
                ParallelizationFactor: 2,
            })
        })
    })

    describe('IAM role permissions', () => {
        it('should grant CloudWatch Logs write permissions', () => {
            const stack = createStack()
            const table = createTableWithStream(stack)

            new DynamoDbAuditLogging(stack, 'Audit', {
                sourceTable: table,
                lambdaCodePath: HANDLER_PATH,
                enableCrawler: false,
            })

            const template = Template.fromStack(stack)
            template.hasResourceProperties('AWS::IAM::Role', {
                Policies: Match.arrayWith([
                    Match.objectLike({
                        PolicyDocument: {
                            Statement: Match.arrayWith([
                                Match.objectLike({
                                    Effect: 'Allow',
                                    Action: [
                                        'logs:CreateLogGroup',
                                        'logs:CreateLogStream',
                                        'logs:PutLogEvents',
                                    ],
                                }),
                            ]),
                        },
                    }),
                ]),
            })
        })

        it('should grant S3 PutObject and GetObject permissions', () => {
            const stack = createStack()
            const table = createTableWithStream(stack)

            new DynamoDbAuditLogging(stack, 'Audit', {
                sourceTable: table,
                lambdaCodePath: HANDLER_PATH,
                enableCrawler: false,
            })

            const template = Template.fromStack(stack)
            template.hasResourceProperties('AWS::IAM::Role', {
                Policies: Match.arrayWith([
                    Match.objectLike({
                        PolicyDocument: {
                            Statement: Match.arrayWith([
                                Match.objectLike({
                                    Effect: 'Allow',
                                    Action: [
                                        's3:PutObject',
                                        's3:GetObject',
                                    ],
                                }),
                            ]),
                        },
                    }),
                ]),
            })
        })

        it('should grant S3 ListBucket permission', () => {
            const stack = createStack()
            const table = createTableWithStream(stack)

            new DynamoDbAuditLogging(stack, 'Audit', {
                sourceTable: table,
                lambdaCodePath: HANDLER_PATH,
                enableCrawler: false,
            })

            const template = Template.fromStack(stack)
            template.hasResourceProperties('AWS::IAM::Role', {
                Policies: Match.arrayWith([
                    Match.objectLike({
                        PolicyDocument: {
                            Statement: Match.arrayWith([
                                Match.objectLike({
                                    Effect: 'Allow',
                                    Action: 's3:ListBucket',
                                }),
                            ]),
                        },
                    }),
                ]),
            })
        })
    })
})
