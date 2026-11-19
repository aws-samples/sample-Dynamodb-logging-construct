import { describe, it, expect } from 'vitest'
import { App, Aspects, Stack } from 'aws-cdk-lib'
import { Annotations, Match } from 'aws-cdk-lib/assertions'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as path from 'path'
import { AwsSolutionsChecks } from 'cdk-nag'
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

describe('CDK Nag Compliance', () => {
    it('should have zero unsuppressed errors with enableCrawler: true', () => {
        const stack = createStack()
        const table = createTableWithStream(stack)

        new DynamoDbAuditLogging(stack, 'Audit', {
            sourceTable: table,
            lambdaCodePath: HANDLER_PATH,
            prefix: 'myapp',
            stage: 'dev',
            enableCrawler: true,
        })

        Aspects.of(stack).add(new AwsSolutionsChecks({ verbose: true }))

        const annotations = Annotations.fromStack(stack)
        annotations.hasNoError('/TestStack/Audit/*', Match.anyValue())
    })

    it('should have zero unsuppressed warnings with enableCrawler: true', () => {
        const stack = createStack()
        const table = createTableWithStream(stack)

        new DynamoDbAuditLogging(stack, 'Audit', {
            sourceTable: table,
            lambdaCodePath: HANDLER_PATH,
            prefix: 'myapp',
            stage: 'dev',
            enableCrawler: true,
        })

        Aspects.of(stack).add(new AwsSolutionsChecks({ verbose: true }))

        const annotations = Annotations.fromStack(stack)
        annotations.hasNoWarning('/TestStack/Audit/*', Match.anyValue())
    })

    it('should have zero unsuppressed errors with enableCrawler: false', () => {
        const stack = createStack()
        const table = createTableWithStream(stack)

        new DynamoDbAuditLogging(stack, 'Audit', {
            sourceTable: table,
            lambdaCodePath: HANDLER_PATH,
            prefix: 'myapp',
            stage: 'dev',
            enableCrawler: false,
        })

        Aspects.of(stack).add(new AwsSolutionsChecks({ verbose: true }))

        const annotations = Annotations.fromStack(stack)
        annotations.hasNoError('/TestStack/Audit/*', Match.anyValue())
    })

    it('should have zero unsuppressed warnings with enableCrawler: false', () => {
        const stack = createStack()
        const table = createTableWithStream(stack)

        new DynamoDbAuditLogging(stack, 'Audit', {
            sourceTable: table,
            lambdaCodePath: HANDLER_PATH,
            prefix: 'myapp',
            stage: 'dev',
            enableCrawler: false,
        })

        Aspects.of(stack).add(new AwsSolutionsChecks({ verbose: true }))

        const annotations = Annotations.fromStack(stack)
        annotations.hasNoWarning('/TestStack/Audit/*', Match.anyValue())
    })
})
