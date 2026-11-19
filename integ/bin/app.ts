#!/usr/bin/env node
import 'source-map-support/register'
import { App } from 'aws-cdk-lib'
import { IntegTestStack } from '../lib/integ-test-stack'

const app = new App()

new IntegTestStack(app, 'DynamoDbAuditLoggingIntegTest', {
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
    },
})
