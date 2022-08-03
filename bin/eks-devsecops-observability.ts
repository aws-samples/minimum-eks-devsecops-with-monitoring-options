#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { EksDevsecopsObservabilityStack } from '../lib/eks-devsecops-observability-stack';

const app = new cdk.App();
new EksDevsecopsObservabilityStack(app, 'EksDevsecopsObservabilityStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT, 
    region: 'us-west-2'
  },
});