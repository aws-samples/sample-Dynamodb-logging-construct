import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { App, Stack } from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'
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

const validNameArb = fc.string({ minLength: 1, maxLength: 20 })
    .filter(s => /^[a-z][a-z0-9-]*$/.test(s))

/**
 * Extracts the bucket name string from the CloudFormation template.
 * The bucket name uses Fn::Join with AWS::AccountId, so we extract
 * the static prefix portion which contains prefix and stage.
 */
function extractBucketNamePrefix(bucketProps: any): string {
    const bucketName = bucketProps.BucketName
    if (typeof bucketName === 'string') {
        return bucketName
    }
    // Handle Fn::Join case: { "Fn::Join": ["", ["prefix-audit-stage-", { "Ref": "AWS::AccountId" }]] }
    if (bucketName && bucketName['Fn::Join']) {
        const parts = bucketName['Fn::Join'][1]
        return parts.filter((p: any) => typeof p === 'string').join('')
    }
    return ''
}

describe('Feature: dynamodb-audit-logging-construct, Property 2: Prefix appears in all resource names', () => {
    it('For any valid prefix string, every physical resource name SHALL contain the prefix value', () => {
        /**
         * **Validates: Requirements 1.8, 2.6, 6.1**
         */
        fc.assert(
            fc.property(
                validNameArb,
                (prefix) => {
                    const stack = createStack()
                    const table = createTableWithStream(stack)

                    new DynamoDbAuditLogging(stack, 'Audit', {
                        sourceTable: table,
                        lambdaCodePath: HANDLER_PATH,
                        prefix,
                        stage: 'dev',
                        enableCrawler: true,
                    })

                    const template = Template.fromStack(stack)

                    // Check S3 bucket name contains prefix
                    const buckets = template.findResources('AWS::S3::Bucket')
                    for (const bucket of Object.values(buckets)) {
                        const bucketNameStr = extractBucketNamePrefix((bucket as any).Properties)
                        expect(bucketNameStr).toContain(prefix)
                    }

                    // Check Lambda function name contains prefix
                    const lambdas = template.findResources('AWS::Lambda::Function')
                    for (const fn of Object.values(lambdas)) {
                        const functionName = (fn as any).Properties.FunctionName
                        expect(functionName).toContain(prefix)
                    }

                    // Check IAM role names contain prefix
                    const roles = template.findResources('AWS::IAM::Role')
                    for (const role of Object.values(roles)) {
                        const roleName = (role as any).Properties.RoleName
                        if (roleName) {
                            expect(roleName).toContain(prefix)
                        }
                    }

                    // Check Glue DB name contains prefix (with hyphens replaced by underscores)
                    const databases = template.findResources('AWS::Glue::Database')
                    const prefixUnderscored = prefix.replace(/-/g, '_')
                    for (const db of Object.values(databases)) {
                        const dbName = (db as any).Properties.DatabaseInput.Name
                        expect(dbName).toContain(prefixUnderscored)
                    }

                    // Check Glue Crawler name contains prefix
                    const crawlers = template.findResources('AWS::Glue::Crawler')
                    for (const crawler of Object.values(crawlers)) {
                        const crawlerName = (crawler as any).Properties.Name
                        expect(crawlerName).toContain(prefix)
                    }
                }
            ),
            { numRuns: 100 }
        )
    })
})

describe('Feature: dynamodb-audit-logging-construct, Property 3: Stage appears in all resource names', () => {
    it('For any valid stage string, every physical resource name SHALL contain the stage value', () => {
        /**
         * **Validates: Requirements 6.2**
         */
        fc.assert(
            fc.property(
                validNameArb,
                (stage) => {
                    const stack = createStack()
                    const table = createTableWithStream(stack)

                    new DynamoDbAuditLogging(stack, 'Audit', {
                        sourceTable: table,
                        lambdaCodePath: HANDLER_PATH,
                        prefix: 'myapp',
                        stage,
                        enableCrawler: true,
                    })

                    const template = Template.fromStack(stack)

                    // Check S3 bucket name contains stage
                    const buckets = template.findResources('AWS::S3::Bucket')
                    for (const bucket of Object.values(buckets)) {
                        const bucketNameStr = extractBucketNamePrefix((bucket as any).Properties)
                        expect(bucketNameStr).toContain(stage)
                    }

                    // Check Lambda function name contains stage
                    const lambdas = template.findResources('AWS::Lambda::Function')
                    for (const fn of Object.values(lambdas)) {
                        const functionName = (fn as any).Properties.FunctionName
                        expect(functionName).toContain(stage)
                    }

                    // Check IAM role names contain stage
                    const roles = template.findResources('AWS::IAM::Role')
                    for (const role of Object.values(roles)) {
                        const roleName = (role as any).Properties.RoleName
                        if (roleName) {
                            expect(roleName).toContain(stage)
                        }
                    }

                    // Check Glue DB name contains stage (with hyphens replaced by underscores)
                    const databases = template.findResources('AWS::Glue::Database')
                    const stageUnderscored = stage.replace(/-/g, '_')
                    for (const db of Object.values(databases)) {
                        const dbName = (db as any).Properties.DatabaseInput.Name
                        expect(dbName).toContain(stageUnderscored)
                    }

                    // Check Glue Crawler name contains stage
                    const crawlers = template.findResources('AWS::Glue::Crawler')
                    for (const crawler of Object.values(crawlers)) {
                        const crawlerName = (crawler as any).Properties.Name
                        expect(crawlerName).toContain(stage)
                    }
                }
            ),
            { numRuns: 100 }
        )
    })
})

describe('Feature: dynamodb-audit-logging-construct, Property 4: Tag propagation to all resources', () => {
    it('For any valid Record<string, string> provided as tags, every resource SHALL have all provided tags applied', () => {
        /**
         * **Validates: Requirements 6.4**
         */
        const tagKeyArb = fc.string({ minLength: 1, maxLength: 10 })
            .filter(s => /^[a-zA-Z][a-zA-Z0-9]*$/.test(s))

        const tagValueArb = fc.string({ minLength: 1, maxLength: 20 })

        const tagsArb = fc.dictionary(tagKeyArb, tagValueArb)

        fc.assert(
            fc.property(
                tagsArb,
                (tags) => {
                    const stack = createStack()
                    const table = createTableWithStream(stack)

                    new DynamoDbAuditLogging(stack, 'Audit', {
                        sourceTable: table,
                        lambdaCodePath: HANDLER_PATH,
                        prefix: 'myapp',
                        stage: 'dev',
                        enableCrawler: true,
                        tags,
                    })

                    const template = Template.fromStack(stack)

                    // Check tags on S3 bucket
                    const buckets = template.findResources('AWS::S3::Bucket')
                    for (const bucket of Object.values(buckets)) {
                        const resourceTags = (bucket as any).Properties.Tags || []
                        for (const [key, value] of Object.entries(tags)) {
                            const found = resourceTags.some(
                                (t: any) => t.Key === key && t.Value === value
                            )
                            expect(found, `Expected tag ${key}=${value} on S3 bucket`).toBe(true)
                        }
                    }

                    // Check tags on Lambda function
                    const lambdas = template.findResources('AWS::Lambda::Function')
                    for (const fn of Object.values(lambdas)) {
                        const resourceTags = (fn as any).Properties.Tags || []
                        for (const [key, value] of Object.entries(tags)) {
                            const found = resourceTags.some(
                                (t: any) => t.Key === key && t.Value === value
                            )
                            expect(found, `Expected tag ${key}=${value} on Lambda function`).toBe(true)
                        }
                    }

                    // Check tags on IAM roles
                    const roles = template.findResources('AWS::IAM::Role')
                    for (const role of Object.values(roles)) {
                        const resourceTags = (role as any).Properties.Tags || []
                        for (const [key, value] of Object.entries(tags)) {
                            const found = resourceTags.some(
                                (t: any) => t.Key === key && t.Value === value
                            )
                            expect(found, `Expected tag ${key}=${value} on IAM role`).toBe(true)
                        }
                    }
                }
            ),
            { numRuns: 100 }
        )
    })
})
