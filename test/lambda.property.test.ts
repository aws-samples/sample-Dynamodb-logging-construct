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

describe('Feature: dynamodb-audit-logging-construct, Property 1: Environment variable merging preserves all entries', () => {
    it('For any valid Record<string, string> provided as lambdaEnvironment, the synthesized Lambda SHALL contain every key-value pair plus AUDIT_BUCKET_NAME and S3_KEY_PREFIX', () => {
        /**
         * **Validates: Requirements 1.6, 3.4**
         */
        const envKeyArb = fc.string({ minLength: 1, maxLength: 10 })
            .filter(s => /^[A-Z_][A-Z0-9_]*$/.test(s))
            .filter(s => s !== 'AUDIT_BUCKET_NAME' && s !== 'S3_KEY_PREFIX')

        const envValueArb = fc.string({ minLength: 1, maxLength: 20 })

        const lambdaEnvironmentArb = fc.dictionary(envKeyArb, envValueArb)

        fc.assert(
            fc.property(
                lambdaEnvironmentArb,
                (lambdaEnvironment) => {
                    const stack = createStack()
                    const table = createTableWithStream(stack)

                    new DynamoDbAuditLogging(stack, 'Audit', {
                        sourceTable: table,
                        lambdaCodePath: HANDLER_PATH,
                        enableCrawler: false,
                        lambdaEnvironment,
                    })

                    const template = Template.fromStack(stack)
                    const lambdas = template.findResources('AWS::Lambda::Function')
                    const lambdaLogicalIds = Object.keys(lambdas)

                    expect(lambdaLogicalIds.length).toBeGreaterThan(0)

                    const lambdaResource = lambdas[lambdaLogicalIds[0]]
                    const envVars = lambdaResource.Properties.Environment.Variables

                    // Assert construct-injected variables are present
                    expect(envVars).toHaveProperty('AUDIT_BUCKET_NAME')
                    expect(envVars).toHaveProperty('S3_KEY_PREFIX')

                    // Assert every user-provided key-value pair is present
                    for (const [key, value] of Object.entries(lambdaEnvironment)) {
                        expect(envVars).toHaveProperty(key)
                        expect(envVars[key]).toBe(value)
                    }
                }
            ),
            { numRuns: 100 }
        )
    })
})
