#!/usr/bin/env node
import { CdkpipelinesStack } from '../lib/cdkpipelines-stack';
import { BootstrapAdminRole } from '../lib/bootstrap-cross-account-admin-role';
import * as cdk from 'aws-cdk-lib';

const app = new cdk.App();
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION
}

const targetStack = app.node.tryGetContext('TargetStack');


if (targetStack == 'CdkpipelinesStack') {
  new CdkpipelinesStack(app, 'CdkpipelinesStack', { env });
}

if (targetStack == 'BootstrapAdminRole') {
  new BootstrapAdminRole(app, 'BootstrapAdminRole', { env })
}

app.synth();