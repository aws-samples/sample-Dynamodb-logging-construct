import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { App, Stack } from 'aws-cdk-lib'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as kms from 'aws-cdk-lib/aws-kms'
import * as path from 'path'
import { DynamoDbAuditLogging } from '../lib'

const HANDLER_PATH = path.join(__dirname, 'fixtures', 'handler')

function createTableWithStream(stack: Stack, id: string): dynamodb.Table {
    return new dynamodb.Table(stack, id, {
        partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
        stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
    })
}

function createTableWithoutStream(stack: Stack, id: string): dynamodb.ITable {
    return dynamodb.Table.fromTableAttributes(stack, id, {
        tableArn: 'arn:aws:dynamodb:us-east-1:123456789012:table/NoStreamTable',
    })
}

describe('Feature: dynamodb-audit-logging-construct, Property 5: Stream-disabled table validation', () => {
    it('For any DynamoDB table without streams enabled, constructing DynamoDbAuditLogging SHALL throw; with streams enabled SHALL NOT throw', () => {
        /**
         * **Validates: Requirements 8.1**
         */
        fc.assert(
            fc.property(
                fc.boolean(),
                (streamsEnabled) => {
                    const app = new App()
                    const stack = new Stack(app, 'TestStack')

                    if (streamsEnabled) {
                        const table = createTableWithStream(stack, 'Table')
                        expect(() => {
                            new DynamoDbAuditLogging(stack, 'Audit', {
                                sourceTable: table,
                                lambdaCodePath: HANDLER_PATH,
                                enableCrawler: false,
                            })
                        }).not.toThrow()
                    } else {
                        const table = createTableWithoutStream(stack, 'Table')
                        expect(() => {
                            new DynamoDbAuditLogging(stack, 'Audit', {
                                sourceTable: table,
                                lambdaCodePath: HANDLER_PATH,
                                enableCrawler: false,
                            })
                        }).toThrow(/sourceTable must have DynamoDB Streams enabled/)
                    }
                }
            ),
            { numRuns: 100 }
        )
    })
})

describe('Feature: dynamodb-audit-logging-construct, Property 6: Mutually exclusive props validation', () => {
    it('For any props where both existingAuditBucket and encryptionKey are provided, SHALL throw; for both existingAuditBucket and s3LifecycleRules, SHALL throw; when only one of each conflicting pair is provided, SHALL NOT throw', () => {
        /**
         * **Validates: Requirements 8.2, 8.3**
         */
        fc.assert(
            fc.property(
                fc.record({
                    hasExistingBucket: fc.boolean(),
                    hasEncryptionKey: fc.boolean(),
                    hasLifecycleRules: fc.boolean(),
                }),
                ({ hasExistingBucket, hasEncryptionKey, hasLifecycleRules }) => {
                    const app = new App()
                    const stack = new Stack(app, 'TestStack')
                    const table = createTableWithStream(stack, 'Table')

                    const props: any = {
                        sourceTable: table,
                        lambdaCodePath: HANDLER_PATH,
                        enableCrawler: false,
                    }

                    if (hasExistingBucket) {
                        props.existingAuditBucket = s3.Bucket.fromBucketName(
                            stack, 'ExistingBucket', 'my-existing-bucket'
                        )
                    }

                    if (hasEncryptionKey) {
                        props.encryptionKey = new kms.Key(stack, 'Key')
                    }

                    if (hasLifecycleRules) {
                        props.s3LifecycleRules = [{ expiration: { days: 90 } }]
                    }

                    const shouldThrowEncryption = hasExistingBucket && hasEncryptionKey
                    const shouldThrowLifecycle = hasExistingBucket && hasLifecycleRules

                    if (shouldThrowEncryption) {
                        expect(() => {
                            new DynamoDbAuditLogging(stack, 'Audit', props)
                        }).toThrow(/Cannot specify encryptionKey when using existingAuditBucket/)
                    } else if (shouldThrowLifecycle) {
                        expect(() => {
                            new DynamoDbAuditLogging(stack, 'Audit', props)
                        }).toThrow(/Cannot specify s3LifecycleRules when using existingAuditBucket/)
                    } else {
                        expect(() => {
                            new DynamoDbAuditLogging(stack, 'Audit', props)
                        }).not.toThrow()
                    }
                }
            ),
            { numRuns: 100 }
        )
    })
})

describe('Feature: dynamodb-audit-logging-construct, Property 7: Numeric range validation', () => {
    it('For any streamBatchSize outside [1, 10000], SHALL throw; for values within valid range, SHALL NOT throw', () => {
        /**
         * **Validates: Requirements 8.4**
         */
        fc.assert(
            fc.property(
                fc.integer({ min: -100000, max: 100000 }),
                (batchSize) => {
                    const app = new App()
                    const stack = new Stack(app, 'TestStack')
                    const table = createTableWithStream(stack, 'Table')

                    const isValid = batchSize >= 1 && batchSize <= 10000

                    if (isValid) {
                        expect(() => {
                            new DynamoDbAuditLogging(stack, 'Audit', {
                                sourceTable: table,
                                lambdaCodePath: HANDLER_PATH,
                                enableCrawler: false,
                                streamBatchSize: batchSize,
                            })
                        }).not.toThrow()
                    } else {
                        expect(() => {
                            new DynamoDbAuditLogging(stack, 'Audit', {
                                sourceTable: table,
                                lambdaCodePath: HANDLER_PATH,
                                enableCrawler: false,
                                streamBatchSize: batchSize,
                            })
                        }).toThrow(/streamBatchSize must be between 1 and 10000/)
                    }
                }
            ),
            { numRuns: 100 }
        )
    })

    it('For any streamParallelizationFactor outside [1, 10], SHALL throw; for values within valid range, SHALL NOT throw', () => {
        /**
         * **Validates: Requirements 8.5**
         */
        fc.assert(
            fc.property(
                fc.integer({ min: -100, max: 100 }),
                (parallelizationFactor) => {
                    const app = new App()
                    const stack = new Stack(app, 'TestStack')
                    const table = createTableWithStream(stack, 'Table')

                    const isValid = parallelizationFactor >= 1 && parallelizationFactor <= 10

                    if (isValid) {
                        expect(() => {
                            new DynamoDbAuditLogging(stack, 'Audit', {
                                sourceTable: table,
                                lambdaCodePath: HANDLER_PATH,
                                enableCrawler: false,
                                streamParallelizationFactor: parallelizationFactor,
                            })
                        }).not.toThrow()
                    } else {
                        expect(() => {
                            new DynamoDbAuditLogging(stack, 'Audit', {
                                sourceTable: table,
                                lambdaCodePath: HANDLER_PATH,
                                enableCrawler: false,
                                streamParallelizationFactor: parallelizationFactor,
                            })
                        }).toThrow(/streamParallelizationFactor must be between 1 and 10/)
                    }
                }
            ),
            { numRuns: 100 }
        )
    })
})
