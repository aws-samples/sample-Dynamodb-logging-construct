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

describe('Glue Database and Crawler', () => {
    describe('when enableCrawler is true (default)', () => {
        it('should create a Glue Database', () => {
            const stack = createStack()
            const table = createTableWithStream(stack)

            new DynamoDbAuditLogging(stack, 'Audit', {
                sourceTable: table,
                lambdaCodePath: HANDLER_PATH,
                prefix: 'myapp',
                stage: 'prod',
            })

            const template = Template.fromStack(stack)
            template.hasResourceProperties('AWS::Glue::Database', {
                DatabaseInput: {
                    Name: 'myapp_audit_db_prod',
                },
            })
        })

        it('should create a Glue Crawler', () => {
            const stack = createStack()
            const table = createTableWithStream(stack)

            new DynamoDbAuditLogging(stack, 'Audit', {
                sourceTable: table,
                lambdaCodePath: HANDLER_PATH,
                prefix: 'myapp',
                stage: 'prod',
            })

            const template = Template.fromStack(stack)
            template.hasResourceProperties('AWS::Glue::Crawler', {
                Name: 'myapp-audit-crawler-prod',
            })
        })

        it('should create a Crawler IAM Role', () => {
            const stack = createStack()
            const table = createTableWithStream(stack)

            new DynamoDbAuditLogging(stack, 'Audit', {
                sourceTable: table,
                lambdaCodePath: HANDLER_PATH,
                prefix: 'myapp',
                stage: 'prod',
            })

            const template = Template.fromStack(stack)
            template.hasResourceProperties('AWS::IAM::Role', {
                RoleName: 'myapp-audit-crawler-role-prod',
                AssumeRolePolicyDocument: {
                    Statement: Match.arrayWith([
                        Match.objectLike({
                            Principal: { Service: 'glue.amazonaws.com' },
                        }),
                    ]),
                },
            })
        })
    })

    describe('when enableCrawler is false', () => {
        it('should not create any Glue resources', () => {
            const stack = createStack()
            const table = createTableWithStream(stack)

            new DynamoDbAuditLogging(stack, 'Audit', {
                sourceTable: table,
                lambdaCodePath: HANDLER_PATH,
                enableCrawler: false,
            })

            const template = Template.fromStack(stack)
            template.resourceCountIs('AWS::Glue::Database', 0)
            template.resourceCountIs('AWS::Glue::Crawler', 0)
        })
    })

    describe('crawler configuration', () => {
        it('should configure the default crawler schedule', () => {
            const stack = createStack()
            const table = createTableWithStream(stack)

            new DynamoDbAuditLogging(stack, 'Audit', {
                sourceTable: table,
                lambdaCodePath: HANDLER_PATH,
            })

            const template = Template.fromStack(stack)
            template.hasResourceProperties('AWS::Glue::Crawler', {
                Schedule: {
                    ScheduleExpression: 'cron(0 */6 * * ? *)',
                },
            })
        })

        it('should configure a custom crawler schedule', () => {
            const stack = createStack()
            const table = createTableWithStream(stack)

            new DynamoDbAuditLogging(stack, 'Audit', {
                sourceTable: table,
                lambdaCodePath: HANDLER_PATH,
                crawlerSchedule: 'cron(0 0 * * ? *)',
            })

            const template = Template.fromStack(stack)
            template.hasResourceProperties('AWS::Glue::Crawler', {
                Schedule: {
                    ScheduleExpression: 'cron(0 0 * * ? *)',
                },
            })
        })

        it('should configure schema change policy with LOG and UPDATE_IN_DATABASE', () => {
            const stack = createStack()
            const table = createTableWithStream(stack)

            new DynamoDbAuditLogging(stack, 'Audit', {
                sourceTable: table,
                lambdaCodePath: HANDLER_PATH,
            })

            const template = Template.fromStack(stack)
            template.hasResourceProperties('AWS::Glue::Crawler', {
                SchemaChangePolicy: {
                    DeleteBehavior: 'LOG',
                    UpdateBehavior: 'UPDATE_IN_DATABASE',
                },
            })
        })

        it('should configure the default table prefix', () => {
            const stack = createStack()
            const table = createTableWithStream(stack)

            new DynamoDbAuditLogging(stack, 'Audit', {
                sourceTable: table,
                lambdaCodePath: HANDLER_PATH,
            })

            const template = Template.fromStack(stack)
            template.hasResourceProperties('AWS::Glue::Crawler', {
                TablePrefix: 'audit_',
            })
        })

        it('should configure a custom table prefix', () => {
            const stack = createStack()
            const table = createTableWithStream(stack)

            new DynamoDbAuditLogging(stack, 'Audit', {
                sourceTable: table,
                lambdaCodePath: HANDLER_PATH,
                crawlerTablePrefix: 'custom_',
            })

            const template = Template.fromStack(stack)
            template.hasResourceProperties('AWS::Glue::Crawler', {
                TablePrefix: 'custom_',
            })
        })

        it('should configure recrawl policy to CRAWL_EVERYTHING', () => {
            const stack = createStack()
            const table = createTableWithStream(stack)

            new DynamoDbAuditLogging(stack, 'Audit', {
                sourceTable: table,
                lambdaCodePath: HANDLER_PATH,
            })

            const template = Template.fromStack(stack)
            template.hasResourceProperties('AWS::Glue::Crawler', {
                RecrawlPolicy: {
                    RecrawlBehavior: 'CRAWL_EVERYTHING',
                },
            })
        })
    })

    describe('crawler IAM role permissions', () => {
        it('should have AWSGlueServiceRole managed policy', () => {
            const stack = createStack()
            const table = createTableWithStream(stack)

            new DynamoDbAuditLogging(stack, 'Audit', {
                sourceTable: table,
                lambdaCodePath: HANDLER_PATH,
            })

            const template = Template.fromStack(stack)
            template.hasResourceProperties('AWS::IAM::Role', {
                RoleName: Match.stringLikeRegexp('.*crawler-role.*'),
                ManagedPolicyArns: Match.arrayWith([
                    Match.objectLike({
                        'Fn::Join': Match.arrayWith([
                            Match.arrayWith([
                                Match.stringLikeRegexp('.*iam.*policy/service-role/AWSGlueServiceRole'),
                            ]),
                        ]),
                    }),
                ]),
            })
        })

        it('should have S3 GetObject permission on audit bucket prefix', () => {
            const stack = createStack()
            const table = createTableWithStream(stack)

            new DynamoDbAuditLogging(stack, 'Audit', {
                sourceTable: table,
                lambdaCodePath: HANDLER_PATH,
            })

            const template = Template.fromStack(stack)
            template.hasResourceProperties('AWS::IAM::Role', {
                RoleName: Match.stringLikeRegexp('.*crawler-role.*'),
                Policies: Match.arrayWith([
                    Match.objectLike({
                        PolicyDocument: {
                            Statement: Match.arrayWith([
                                Match.objectLike({
                                    Effect: 'Allow',
                                    Action: 's3:GetObject',
                                }),
                            ]),
                        },
                    }),
                ]),
            })
        })

        it('should have S3 ListBucket permission on audit bucket', () => {
            const stack = createStack()
            const table = createTableWithStream(stack)

            new DynamoDbAuditLogging(stack, 'Audit', {
                sourceTable: table,
                lambdaCodePath: HANDLER_PATH,
            })

            const template = Template.fromStack(stack)
            template.hasResourceProperties('AWS::IAM::Role', {
                RoleName: Match.stringLikeRegexp('.*crawler-role.*'),
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
