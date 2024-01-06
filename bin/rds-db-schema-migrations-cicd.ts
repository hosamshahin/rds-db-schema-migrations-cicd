#!/usr/bin/env node
import { CdkpipelinesStack } from '../lib/cdkpipelines-stack';
import { App } from '@aws-cdk/core';

const app = new App();

new CdkpipelinesStack(app, 'CdkpipelinesStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION
  },
});

app.synth();